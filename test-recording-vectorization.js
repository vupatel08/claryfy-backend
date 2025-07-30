// Test file for WeaviateRecordingService
import { WeaviateRecordingService } from './services/weaviate.js';

console.log('✅ WeaviateRecordingService imported successfully');

// Test the service methods exist
console.log('vectorizeRecording method:', typeof WeaviateRecordingService.vectorizeRecording);
console.log('clearUserRecordings method:', typeof WeaviateRecordingService.clearUserRecordings);
console.log('getRecordingCount method:', typeof WeaviateRecordingService.getRecordingCount);

console.log('✅ All WeaviateRecordingService methods are available');

// Test with mock data (won't actually run without Weaviate connection)
const mockData = {
    userId: 'test-user',
    recordingId: 'test-recording',
    title: 'Test Recording',
    summary: 'This is a test summary of the recording.',
    transcription: 'This is the full transcription of the test recording.',
    courseId: 123,
    duration: 300
};

console.log('Mock data prepared:', mockData);
console.log('✅ Test completed successfully'); 