import os
os.environ['TORCH_HOME'] = '/tmp/torch'
os.environ['TRANSFORMERS_CACHE'] = '/tmp'
import boto3
import torch
import torchvision.transforms as transforms
from torchvision import models
from PIL import Image
import json
import os
import urllib.request
from decimal import Decimal
from datetime import datetime, timezone

# AWS CLIENTS
# created outside handler for reuse
s3_client = boto3.client('s3')
dynamodb = boto3.resource('dynamodb')

# MAIN HANDLER
def handler(event, context):
    print(f'Received event: {json.dumps(event)}')

    record_id = event.get('recordId')
    bucket_name = event.get('bucketName')
    table_name = os.environ.get('TABLE_NAME')
    region = os.environ.get('REGION')

    if not record_id or not bucket_name or not table_name:
        raise ValueError('Missing required fields: recordId, bucketName, TABLE_NAME')

    table = dynamodb.Table(table_name)

    try:
        # Step 1 : Update status to PROCESSING
        update_status(table, record_id, 'PROCESSING')

        # Step 2 : Fetch record from DynamoDB
        print(f'Fetching record: {record_id}')
        record = get_record(table, record_id)

        # Step 3 : Download image from S3
        print('Downloading image from S3...')
        image_path = download_image(bucket_name, record['inputFilePath'])

        # Step 4 : Run classification
        print('Running ResNet50 classification...')
        predictions = classify_image(image_path)
        print(f'Top prediction: {predictions[0]}')

        # Step 5 : Save results to S3
        print('Saving results to S3...')
        output_file_path = save_results(
            bucket_name, 
            record_id, 
            predictions
        )

        # Step 6 : Update DynamoDB with results
        print('Updating DynamoDB with results...')
        save_to_dynamodb(
            table, 
            record_id, 
            output_file_path, 
            predictions
        )

        print('Classification complete!')
        return {
            'statusCode': 200,
            'body': json.dumps({
                'recordId': record_id,
                'predictions': [
                    {
                        'label': p['label'],
                        'confidence': float(p['confidence'])
                    }
                    for p in predictions
                ]
            })
}

    except Exception as e:
        print(f'Error during classification: {str(e)}')
        update_status(table, record_id, 'FAILED', str(e))
        raise e

# UPDATE DYNAMODB STATUS
def update_status(table, record_id, status, error=None):
    update_expr = 'SET #s = :s'
    expr_values = {':s': status}
    expr_names = {'#s': 'status'}

    if error:
        update_expr += ', errorMessage = :e'
        expr_values[':e'] = error

    table.update_item(
        Key={'id': record_id},
        UpdateExpression=update_expr,
        ExpressionAttributeValues=expr_values,
        ExpressionAttributeNames=expr_names
    )

# GET RECORD FROM DYNAMODB
def get_record(table, record_id):
    response = table.get_item(Key={'id': record_id})
    item = response.get('Item')

    if not item:
        raise ValueError(f'Record not found: {record_id}')

    return item

# DOWNLOAD IMAGE FROM S3
def download_image(bucket_name, input_file_path):
    # inputFilePath format: "bucket-name/filename.jpg"
    # We need just the key: "filename.jpg"
    file_key = input_file_path.replace(f'{bucket_name}/', '', 1)

    local_path = '/tmp/input-image'
    s3_client.download_file(bucket_name, file_key, local_path)

    return local_path

# LOAD IMAGENET LABELS
def get_imagenet_labels():
    from torchvision.models import ResNet50_Weights
    weights = ResNet50_Weights.IMAGENET1K_V1
    return weights.meta['categories']

# CLASSIFY IMAGE WITH RESNET50
def classify_image(image_path):
    from torchvision.models import ResNet50_Weights
    weights = ResNet50_Weights.IMAGENET1K_V1
    model = models.resnet50(weights=weights)
    model.eval()

    preprocess = weights.transforms()  # use official preprocessing

    image = Image.open(image_path).convert('RGB')
    input_tensor = preprocess(image)
    input_batch = input_tensor.unsqueeze(0)

    with torch.no_grad():
        output = model(input_batch)

    probabilities = torch.nn.functional.softmax(output[0], dim=0)
    top5_prob, top5_idx = torch.topk(probabilities, 5)

    categories = get_imagenet_labels()

    predictions = []
    for i in range(5):
      label = categories[top5_idx[i].item()]
      confidence = round(top5_prob[i].item(), 4)
      predictions.append({
        'label': label,
        'confidence': Decimal(str(confidence))
      })

    return predictions

# SAVE RESULTS TO S3
def save_results(bucket_name, record_id, predictions):
    results = {
        'jobId': record_id,
        'predictions': [
         {
           'label': p['label'],
           'confidence': float(p['confidence'])
         }
          for p in predictions
          ],
        'modelUsed': 'ResNet50',
        'processedAt': datetime.now(timezone.utc).isoformat()
    }

    # Save locally first
    local_output = '/tmp/results.json'
    with open(local_output, 'w') as f:
        json.dump(results, f, indent=2)

    # Upload to S3
    output_key = f'results-{record_id}.json'
    s3_client.upload_file(local_output, bucket_name, output_key)

    return f'{bucket_name}/{output_key}'

# UPDATE DYNAMODB WITH FINAL RESULTS
def save_to_dynamodb(table, record_id, output_file_path, predictions):
    table.update_item(
        Key={'id': record_id},
        UpdateExpression='SET #s = :s, outputFilePath = :o, predictions = :p, completedAt = :c',
        ExpressionAttributeNames={'#s': 'status'},
        ExpressionAttributeValues={
            ':s': 'COMPLETE',
            ':o': output_file_path,
            ':p': predictions,
            ':c': datetime.now(timezone.utc).isoformat()
        }
    )