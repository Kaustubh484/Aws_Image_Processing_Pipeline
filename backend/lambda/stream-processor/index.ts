import { 
  LambdaClient, 
  InvokeCommand,
  InvocationType 
} from '@aws-sdk/client-lambda';
import { DynamoDBStreamEvent } from 'aws-lambda';

// ENVIRONMENT VARIABLES

const REGION = process.env.REGION!;
const ML_LAMBDA_NAME = process.env.ML_LAMBDA_NAME!;
const BUCKET_NAME = process.env.BUCKET_NAME!;

// LAMBDA CLIENT
// created outside handler for reuse
const lambdaClient = new LambdaClient({ region: REGION });

// MAIN HANDLER
export const handler = async (
  event: DynamoDBStreamEvent
): Promise<void> => {

  for (const record of event.Records) {

    // Only process INSERT events
    if (record.eventName !== 'INSERT') {
      console.log('Skipping non-INSERT event:', record.eventName);
      continue;
    }

    const newImage = record.dynamodb?.NewImage;

    if (!newImage) {
      console.log('No new image found in record');
      continue;
    }

    // Extract record ID from DynamoDB raw format
    const recordId = newImage.id?.S;

    if (!recordId) {
      console.log('No record ID found');
      continue;
    }

    console.log('Invoking ML Lambda for record:', recordId);
    await invokeMlLambda(recordId);
  }
};


// INVOKE ML LAMBDA
const invokeMlLambda = async (recordId: string): Promise<void> => {

  // Payload to send to ML Lambda
  const payload = {
    recordId,
    bucketName: BUCKET_NAME,
  };

  const command = new InvokeCommand({
    FunctionName: ML_LAMBDA_NAME,
    // Event = async invocation
    // Lambda 2 does not wait for ML Lambda to finish
    InvocationType: InvocationType.Event,
    Payload: Buffer.from(JSON.stringify(payload)),
  });

  await lambdaClient.send(command);
  console.log('ML Lambda invoked successfully for record:', recordId);
};