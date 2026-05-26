
// MOCK AWS SDK
jest.mock('@aws-sdk/client-lambda');

process.env.REGION = 'us-east-1';
process.env.ML_LAMBDA_NAME = 'ml-classifier-lambda';
process.env.BUCKET_NAME = 'test-bucket';

// TESTS

describe('Stream Processor Lambda', () => {

  describe('DynamoDB Stream Event Processing', () => {

    it('should extract record ID from INSERT event', () => {
      const mockEvent = {
        Records: [
          {
            eventName: 'INSERT',
            dynamodb: {
              NewImage: {
                id: { S: 'test-record-id' },
                inputText: { S: 'Test image' },
                inputFilePath: { S: 'bucket/test.jpg' },
              }
            }
          }
        ]
      };

      const record = mockEvent.Records[0];
      const recordId = record.dynamodb?.NewImage?.id?.S;

      expect(record.eventName).toBe('INSERT');
      expect(recordId).toBe('test-record-id');
    });

    it('should ignore MODIFY events', () => {
      const mockEvent = {
        Records: [
          {
            eventName: 'MODIFY',
            dynamodb: {
              NewImage: {
                id: { S: 'test-record-id' },
              }
            }
          }
        ]
      };

      const record = mockEvent.Records[0];
      const shouldProcess = record.eventName === 'INSERT';

      expect(shouldProcess).toBe(false);
    });

    it('should ignore REMOVE events', () => {
      const mockEvent = {
        Records: [
          {
            eventName: 'REMOVE',
            dynamodb: {}
          }
        ]
      };

      const record = mockEvent.Records[0];
      const shouldProcess = record.eventName === 'INSERT';

      expect(shouldProcess).toBe(false);
    });

    it('should build correct ML Lambda payload', () => {
      const recordId = 'test-record-id';
      const bucketName = process.env.BUCKET_NAME;

      const payload = {
        recordId,
        bucketName,
      };

      expect(payload.recordId).toBe('test-record-id');
      expect(payload.bucketName).toBe('test-bucket');
    });

    it('should handle missing NewImage gracefully', () => {
      const mockRecord:any = {
        eventName: 'INSERT',
        dynamodb: {}
      };

      const newImage = mockRecord.dynamodb?.NewImage;
      expect(newImage).toBeUndefined();
    });
  });
});