-- =============================================
-- CLARYFY SUPABASE DATABASE SCHEMA
-- =============================================

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- =============================================
-- USERS TABLE (extends Supabase auth.users)
-- =============================================

CREATE TABLE public.users (
  id UUID REFERENCES auth.users ON DELETE CASCADE PRIMARY KEY,
  email TEXT NOT NULL,
  canvas_token TEXT, -- Encrypted Canvas token
  canvas_domain TEXT DEFAULT 'umd.instructure.com',
  full_name TEXT,
  avatar_url TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- =============================================
-- CONVERSATIONS TABLE
-- =============================================

CREATE TABLE public.conversations (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  user_id UUID REFERENCES public.users(id) ON DELETE CASCADE NOT NULL,
  course_id INTEGER, -- Canvas course ID
  title TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- =============================================
-- MESSAGES TABLE
-- =============================================

CREATE TABLE public.messages (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  conversation_id UUID REFERENCES public.conversations(id) ON DELETE CASCADE NOT NULL,
  content TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  metadata JSONB DEFAULT '{}'::jsonb, -- Store additional context, token counts, etc.
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- =============================================
-- RECORDINGS TABLE
-- =============================================

CREATE TABLE public.recordings (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  user_id UUID REFERENCES public.users(id) ON DELETE CASCADE NOT NULL,
  course_id INTEGER, -- Canvas course ID
  title TEXT NOT NULL,
  summary TEXT,
  transcription TEXT,
  duration INTEGER, -- Duration in seconds
  audio_url TEXT, -- Temporary storage URL (will be deleted after processing)
  status TEXT DEFAULT 'processing' CHECK (status IN ('processing', 'completed', 'failed')),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  processed_at TIMESTAMP WITH TIME ZONE
);

-- =============================================
-- CANVAS DATA CACHE TABLE
-- =============================================

CREATE TABLE public.canvas_data (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  user_id UUID REFERENCES public.users(id) ON DELETE CASCADE NOT NULL,
  data_type TEXT NOT NULL CHECK (data_type IN ('courses', 'assignments', 'announcements', 'files')),
  course_id INTEGER, -- Canvas course ID (can be NULL for user-level data)
  content JSONB NOT NULL,
  last_synced TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- =============================================
-- INDEXES FOR PERFORMANCE
-- =============================================

-- Conversations indexes
CREATE INDEX idx_conversations_user_id ON public.conversations(user_id);
CREATE INDEX idx_conversations_course_id ON public.conversations(course_id);
CREATE INDEX idx_conversations_created_at ON public.conversations(created_at DESC);

-- Messages indexes
CREATE INDEX idx_messages_conversation_id ON public.messages(conversation_id);
CREATE INDEX idx_messages_created_at ON public.messages(created_at ASC);

-- Recordings indexes
CREATE INDEX idx_recordings_user_id ON public.recordings(user_id);
CREATE INDEX idx_recordings_course_id ON public.recordings(course_id);
CREATE INDEX idx_recordings_status ON public.recordings(status);
CREATE INDEX idx_recordings_created_at ON public.recordings(created_at DESC);

-- Canvas data indexes
CREATE INDEX idx_canvas_data_user_id ON public.canvas_data(user_id);
CREATE INDEX idx_canvas_data_type_course ON public.canvas_data(data_type, course_id);
CREATE INDEX idx_canvas_data_last_synced ON public.canvas_data(last_synced);

-- =============================================
-- ROW LEVEL SECURITY (RLS) POLICIES
-- =============================================

-- Enable RLS on all tables
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.recordings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.canvas_data ENABLE ROW LEVEL SECURITY;

-- Users policies
CREATE POLICY "Users can view their own profile" 
  ON public.users FOR SELECT 
  USING (auth.uid() = id);

CREATE POLICY "Users can update their own profile" 
  ON public.users FOR UPDATE 
  USING (auth.uid() = id);

CREATE POLICY "Users can insert their own profile" 
  ON public.users FOR INSERT 
  WITH CHECK (auth.uid() = id);

-- Conversations policies
CREATE POLICY "Users can view their own conversations" 
  ON public.conversations FOR SELECT 
  USING (auth.uid() = user_id);

CREATE POLICY "Users can create their own conversations" 
  ON public.conversations FOR INSERT 
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own conversations" 
  ON public.conversations FOR UPDATE 
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own conversations" 
  ON public.conversations FOR DELETE 
  USING (auth.uid() = user_id);

-- Messages policies
CREATE POLICY "Users can view messages in their conversations" 
  ON public.messages FOR SELECT 
  USING (
    EXISTS (
      SELECT 1 FROM public.conversations 
      WHERE conversations.id = messages.conversation_id 
      AND conversations.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can create messages in their conversations" 
  ON public.messages FOR INSERT 
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.conversations 
      WHERE conversations.id = messages.conversation_id 
      AND conversations.user_id = auth.uid()
    )
  );

-- Recordings policies
CREATE POLICY "Users can view their own recordings" 
  ON public.recordings FOR SELECT 
  USING (auth.uid() = user_id);

CREATE POLICY "Users can create their own recordings" 
  ON public.recordings FOR INSERT 
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own recordings" 
  ON public.recordings FOR UPDATE 
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own recordings" 
  ON public.recordings FOR DELETE 
  USING (auth.uid() = user_id);

-- Canvas data policies
CREATE POLICY "Users can view their own canvas data" 
  ON public.canvas_data FOR SELECT 
  USING (auth.uid() = user_id);

CREATE POLICY "Users can create their own canvas data" 
  ON public.canvas_data FOR INSERT 
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own canvas data" 
  ON public.canvas_data FOR UPDATE 
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own canvas data" 
  ON public.canvas_data FOR DELETE 
  USING (auth.uid() = user_id);

-- =============================================
-- FUNCTIONS AND TRIGGERS
-- =============================================

-- Function to update the updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ language 'plpgsql';

-- Triggers for updated_at
CREATE TRIGGER update_users_updated_at 
  BEFORE UPDATE ON public.users 
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_conversations_updated_at 
  BEFORE UPDATE ON public.conversations 
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Function to create user profile on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.users (id, email, full_name, avatar_url)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'name'),
    NEW.raw_user_meta_data->>'avatar_url'
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger to automatically create user profile
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- =============================================
-- STORAGE BUCKETS FOR AUDIO FILES
-- =============================================

-- Create storage bucket for audio recordings
INSERT INTO storage.buckets (id, name, public) 
VALUES ('recordings', 'recordings', false);

-- Storage policies for recordings
CREATE POLICY "Users can upload their own recordings" 
  ON storage.objects FOR INSERT 
  WITH CHECK (
    bucket_id = 'recordings' AND 
    auth.uid()::text = (storage.foldername(name))[1]
  );

CREATE POLICY "Users can view their own recordings" 
  ON storage.objects FOR SELECT 
  USING (
    bucket_id = 'recordings' AND 
    auth.uid()::text = (storage.foldername(name))[1]
  );

CREATE POLICY "Users can delete their own recordings" 
  ON storage.objects FOR DELETE 
  USING (
    bucket_id = 'recordings' AND 
    auth.uid()::text = (storage.foldername(name))[1]
  );

-- =============================================
-- HELPFUL VIEWS
-- =============================================

-- View for conversation with message counts
CREATE VIEW conversation_summary AS
SELECT 
  c.*,
  COUNT(m.id) as message_count,
  MAX(m.created_at) as last_message_at
FROM public.conversations c
LEFT JOIN public.messages m ON c.id = m.conversation_id
GROUP BY c.id, c.user_id, c.course_id, c.title, c.created_at, c.updated_at;

-- View for recording summaries with course info
CREATE VIEW recording_summary AS
SELECT 
  r.*,
  cd.content->>'name' as course_name
FROM public.recordings r
LEFT JOIN public.canvas_data cd ON (
  r.user_id = cd.user_id AND 
  cd.data_type = 'courses' AND 
  cd.content->>'id' = r.course_id::text
);

-- =============================================
-- SAMPLE DATA SETUP FUNCTION
-- =============================================

CREATE OR REPLACE FUNCTION setup_sample_data(user_uuid UUID)
RETURNS VOID AS $$
BEGIN
  -- Create a sample conversation
  INSERT INTO public.conversations (user_id, course_id, title)
  VALUES (user_uuid, 12345, 'Sample Chat about Assignment 1');
  
  -- Add a sample message
  INSERT INTO public.messages (conversation_id, content, role)
  SELECT 
    id, 
    'Hello! I need help with my assignment about data structures.', 
    'user'
  FROM public.conversations 
  WHERE user_id = user_uuid AND title = 'Sample Chat about Assignment 1';
  
  INSERT INTO public.messages (conversation_id, content, role)
  SELECT 
    id, 
    'I''d be happy to help you with data structures! Could you tell me more about the specific topic you''re working on?', 
    'assistant'
  FROM public.conversations 
  WHERE user_id = user_uuid AND title = 'Sample Chat about Assignment 1';
END;
$$ LANGUAGE plpgsql; 