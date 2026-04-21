require('dotenv').config();

const { S3Client, GetObjectCommand, PutObjectCommand } = require('@aws-sdk/client-s3');
const { SQSClient, ReceiveMessageCommand, DeleteMessageCommand } = require('@aws-sdk/client-sqs');
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, UpdateCommand } = require('@aws-sdk/lib-dynamodb');

// ---------------------------------------------------------------------------
// AWS clients
// ---------------------------------------------------------------------------

const region = process.env.AWS_REGION;
const s3     = new S3Client({ region });
const sqs    = new SQSClient({ region });
const dynamo = DynamoDBDocumentClient.from(new DynamoDBClient({ region }));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function streamToBuffer(stream) {
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  return Buffer.concat(chunks);
}

async function updateJob(jobId, fields) {
  const entries   = Object.entries(fields);
  const setClauses = entries.map(([k], i) => `#f${i} = :v${i}`).join(', ');
  const names      = Object.fromEntries(entries.map(([k], i) => [`#f${i}`, k]));
  const values     = Object.fromEntries(entries.map(([, v], i) => [`:v${i}`, v]));

  await dynamo.send(new UpdateCommand({
    TableName:                 process.env.DYNAMODB_TABLE,
    Key:                       { jobId },
    UpdateExpression:          `SET ${setClauses}`,
    ExpressionAttributeNames:  names,
    ExpressionAttributeValues: values,
  }));
}

// ---------------------------------------------------------------------------
// Processing logic
// ---------------------------------------------------------------------------

async function processJob(jobId, s3Key, originalName) {
  await updateJob(jobId, { status: 'processing' });

  // Download raw file from S3
  const { Body } = await s3.send(new GetObjectCommand({
    Bucket: process.env.S3_BUCKET,
    Key:    s3Key,
  }));
  const fileBuffer = await streamToBuffer(Body);

  // ── YOUR PROCESSING LOGIC HERE ──────────────────────────────────────────
  // e.g. image resize, virus scan, text extraction, video transcode, etc.
  const result = {
    originalName,
    sizeBytes:   fileBuffer.length,
    processedAt: new Date().toISOString(),
  };
  // ────────────────────────────────────────────────────────────────────────

  // Save result JSON to S3
  const resultKey = `results/${jobId}/result.json`;
  await s3.send(new PutObjectCommand({
    Bucket:      process.env.S3_BUCKET,
    Key:         resultKey,
    Body:        JSON.stringify(result),
    ContentType: 'application/json',
  }));

  await updateJob(jobId, {
    status:      'done',
    result,
    resultKey,
    completedAt: new Date().toISOString(),
  });
}

// ---------------------------------------------------------------------------
// SQS polling loop
// ---------------------------------------------------------------------------

async function poll() {
  console.log('Worker started — polling SQS...');

  while (true) {
    const { Messages } = await sqs.send(new ReceiveMessageCommand({
      QueueUrl:            process.env.SQS_QUEUE_URL,
      MaxNumberOfMessages: 10,
      WaitTimeSeconds:     20, // long polling — reduces cost + latency
    }));

    if (!Messages?.length) continue;

    await Promise.all(Messages.map(async (msg) => {
      const { jobId, s3Key, originalName } = JSON.parse(msg.Body);
      console.log(`Processing job ${jobId} (${originalName})`);

      try {
        await processJob(jobId, s3Key, originalName);
        console.log(`Job ${jobId} done`);
      } catch (err) {
        console.error(`Job ${jobId} failed:`, err.message);
        await updateJob(jobId, { status: 'failed', error: err.message });
        // Message is still deleted below — SQS DLQ handles infrastructure-level retries
      }

      await sqs.send(new DeleteMessageCommand({
        QueueUrl:      process.env.SQS_QUEUE_URL,
        ReceiptHandle: msg.ReceiptHandle,
      }));
    }));
  }
}

poll().catch((err) => {
  console.error('Worker crashed:', err);
  process.exit(1);
});
