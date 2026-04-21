require('dotenv').config();

const express = require('express');
const multer = require('multer');
const crypto = require('crypto');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const { SQSClient, SendMessageCommand } = require('@aws-sdk/client-sqs');
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, PutCommand, GetCommand } = require('@aws-sdk/lib-dynamodb');

const app = express();
const PORT = process.env.PORT || 3000;

// ---------------------------------------------------------------------------
// AWS clients  (credentials come from EC2 instance role in production)
// ---------------------------------------------------------------------------

const region = process.env.AWS_REGION;
const s3     = new S3Client({ region });
const sqs    = new SQSClient({ region });
const dynamo = DynamoDBDocumentClient.from(new DynamoDBClient({ region }));

// ---------------------------------------------------------------------------
// Multer — memory storage so we can stream directly to S3
// ---------------------------------------------------------------------------

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 100 * 1024 * 1024 }, // 100 MB
});

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

/**
 * POST /upload
 * Body: multipart/form-data  field name: "file"
 * Response 202: { jobId, status: "queued" }
 *
 * Flow:
 *   1. Upload raw file to S3  (uploads/<jobId>/<originalName>)
 *   2. Write initial job record to DynamoDB
 *   3. Send processing message to SQS
 */
app.post('/upload', upload.single('file'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file provided. Use field name "file".' });
  }

  const jobId  = crypto.randomUUID();
  const s3Key  = `uploads/${jobId}/${req.file.originalname}`;

  // 1 — store raw file in S3
  await s3.send(new PutObjectCommand({
    Bucket:      process.env.S3_BUCKET,
    Key:         s3Key,
    Body:        req.file.buffer,
    ContentType: req.file.mimetype,
  }));

  // 2 — create job record
  await dynamo.send(new PutCommand({
    TableName: process.env.DYNAMODB_TABLE,
    Item: {
      jobId,
      status:       'queued',
      originalName: req.file.originalname,
      s3Key,
      createdAt:    new Date().toISOString(),
    },
  }));

  // 3 — enqueue work
  await sqs.send(new SendMessageCommand({
    QueueUrl:    process.env.SQS_QUEUE_URL,
    MessageBody: JSON.stringify({ jobId, s3Key, originalName: req.file.originalname }),
  }));

  res.status(202).json({ jobId, status: 'queued' });
});

/**
 * GET /status/:jobId
 * Polls DynamoDB for current job state.
 * Returns: { jobId, status, originalName, createdAt, result?, error?, completedAt? }
 */
app.get('/status/:jobId', async (req, res) => {
  const { Item } = await dynamo.send(new GetCommand({
    TableName: process.env.DYNAMODB_TABLE,
    Key: { jobId: req.params.jobId },
  }));

  if (!Item) return res.status(404).json({ error: 'Job not found' });

  const { s3Key, ...safe } = Item; // don't expose internal S3 key
  res.json(safe);
});

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

app.listen(PORT, () => {
  console.log(`File upload API listening on http://localhost:${PORT}`);
});
