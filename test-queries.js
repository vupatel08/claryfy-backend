// Test queries for Weaviate console
// Run these in the Weaviate GraphQL console

// 1. Get all files for the user
{
  Get {
        CanvasContent(
            where: {
            operator: And,
            operands: [
                { path: ["userId"], operator: Equal, valueString: "a93f6858-95aa-4a13-8c09-558cf7177e7a" },
                { path: ["type"], operator: Equal, valueString: "file" }
            ]
        }
        ) {
            title
            content
            type
            courseId
      metadata {
                filename
                size
            }
        }
    }
}

// First, let's get the vector for our search term
{
  Objects {
    Embed {
            text: "backpropagation neural networks learning algorithm"
        }
    }
}

// Then use that vector in our search:
{
  Get {
        CanvasContent(
            where: {
            operator: And,
            operands: [
                { path: ["userId"], operator: Equal, valueString: "a93f6858-95aa-4a13-8c09-558cf7177e7a" },
                { path: ["courseId"], operator: Equal, valueNumber: 1378023 }
            ]
        },
            nearVector: {
            vector: [-0.001, 0.002, ...] // Replace with the vector from the Embed query above
        },
            limit: 5
        ) {
            title
            content
            type
            courseId
      metadata {
                filename
                size
            }
      _additional {
                distance
            }
        }
    }
}

// Or simpler query just to verify the file exists:
{
  Get {
        CanvasContent(
            where: {
            operator: And,
            operands: [
                { path: ["userId"], operator: Equal, valueString: "a93f6858-95aa-4a13-8c09-558cf7177e7a" },
                { path: ["type"], operator: Equal, valueString: "file" }
            ]
        }
        ) {
            title
            content
            type
            courseId
      metadata {
                filename
                size
            }
        }
    }
}

// 3. Get all content types for this course
{
  Aggregate {
        CanvasContent(
            where: {
            operator: And,
            operands: [
                { path: ["userId"], operator: Equal, valueString: "a93f6858-95aa-4a13-8c09-558cf7177e7a" },
                { path: ["courseId"], operator: Equal, valueNumber: 1378023 }
            ]
        }
        ) {
            type {
                count
            }
      meta {
                count
            }
        }
    }
}

// 4. Get specific file by name
{
  Get {
        CanvasContent(
            where: {
            operator: And,
            operands: [
                { path: ["userId"], operator: Equal, valueString: "a93f6858-95aa-4a13-8c09-558cf7177e7a" },
                { path: ["metadata", "filename"], operator: Equal, valueString: "Backpropagation.pdf" }
            ]
        }
        ) {
            title
            content
            type
            courseId
      metadata {
                filename
                size
            }
        }
    }
}

// 5. Check schema and field types
{
  Get {
        CanvasContent(
            limit: 1
        ) {
      _additional {
                id
                vector
                creationTimeUnix
                lastUpdateTimeUnix
                distance
            }
            title
            content
            type
            courseId
      metadata {
                filename
                size
            }
        }
    }
} 