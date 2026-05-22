import { EC2Client, RunInstancesCommand } from '@aws-sdk/client-ec2';
import { DynamoDBStreamEvent } from 'aws-lambda';



const REGION = process.env.REGION!;
const BUCKET_NAME = process.env.BUCKET_NAME!;
const INSTANCE_PROFILE_ARN = process.env.INSTANCE_PROFILE_ARN!;

const ec2Client = new EC2Client({ region: REGION });



export const handler = async (event: DynamoDBStreamEvent): Promise<void> => {

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

    // Extract the record ID from DynamoDB raw format
    const recordId = newImage.id?.S;

    if (!recordId) {
      console.log('No record ID found');
      continue;
    }

    console.log('Launching EC2 for record:', recordId);
    await launchEc2Instance(recordId);
  }
};


const launchEc2Instance = async (recordId: string): Promise<void> => {

  // This script runs automatically when EC2 boots
  const userDataScript = `#!/bin/bash
set -e

# Variables injected by Lambda
RECORD_ID="${recordId}"
BUCKET_NAME="${BUCKET_NAME}"
REGION="${REGION}"

# Install AWS CLI
yum update -y
yum install -y aws-cli python3 python3-pip

# Download the processing script from S3
aws s3 cp s3://$BUCKET_NAME/processing-script.py /tmp/processing-script.py

# Install Python dependencies
pip3 install torch torchvision Pillow boto3 --quiet

# Run the ML script
python3 /tmp/processing-script.py

# Terminate this instance
INSTANCE_ID=$(curl -s http://169.254.169.254/latest/meta-data/instance-id)
aws ec2 terminate-instances --instance-ids $INSTANCE_ID --region $REGION
`;

  // Convert script to base64 — EC2 requires user data in base64
  const userDataBase64 = Buffer.from(userDataScript).toString('base64');

  const command = new RunInstancesCommand({
    ImageId: 'ami-0c02fb55956c7d316',  // Amazon Linux 2 in us-east-1
    InstanceType: 't3.small',
    MinCount: 1,
    MaxCount: 1,
    IamInstanceProfile: {
      Arn: INSTANCE_PROFILE_ARN,
    },
    UserData: userDataBase64,
    TagSpecifications: [
      {
        ResourceType: 'instance',
        Tags: [
          {
            Key: 'Name',
            Value: `file-processor-${recordId}`,
          },
          {
            Key: 'Purpose',
            Value: 'image-classification',
          },
        ],
      },
    ],
  });

  await ec2Client.send(command);
  console.log('EC2 instance launched for record:', recordId);
};