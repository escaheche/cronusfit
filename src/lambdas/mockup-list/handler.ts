/**
 * Mockup List Lambda Handler
 *
 * GET /api/mockups?status=pending_approval|approved|rejected (JWT required)
 *
 * Lists mockups from DynamoDB filtered by status.
 * Returns presigned URLs for front/back images.
 *
 * @module lambdas/mockup-list
 */

import type { APIGatewayProxyHandler, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand, ScanCommand } from '@aws-sdk/lib-dynamodb';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const s3 = new S3Client({});

const TABLE_NAME = process.env.TABLE_NAME ?? 'CronusFit';
const BUCKET_NAME = process.env.S3_ASSETS_BUCKET ?? 'cronusfit-exhibition-site-prod';

const CORS_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization',
};

function errorResponse(statusCode: number, error: string): APIGatewayProxyResult {
  return {
    statusCode,
    headers: CORS_HEADERS,
    body: JSON.stringify({ error }),
  };
}

async function getPresignedUrl(key: string): Promise<string> {
  const cmd = new GetObjectCommand({ Bucket: BUCKET_NAME, Key: key });
  return getSignedUrl(s3, cmd, { expiresIn: 3600 });
}

export const handler: APIGatewayProxyHandler = async (event): Promise<APIGatewayProxyResult> => {
  try {
    const statusFilter = event.queryStringParameters?.status;

    let items: Record<string, unknown>[] = [];

    if (statusFilter) {
      // Query by GSI1: STATUS#{status} → sorted by creation date
      const result = await ddb.send(new QueryCommand({
        TableName: TABLE_NAME,
        IndexName: 'GSI1',
        KeyConditionExpression: 'GSI1PK = :pk',
        ExpressionAttributeValues: {
          ':pk': `STATUS#${statusFilter}`,
        },
        ScanIndexForward: false, // newest first
        Limit: 100,
      }));
      items = (result.Items ?? []) as Record<string, unknown>[];
    } else {
      // Scan all mockups (limited use, no status filter)
      const result = await ddb.send(new ScanCommand({
        TableName: TABLE_NAME,
        FilterExpression: 'begins_with(PK, :pk)',
        ExpressionAttributeValues: { ':pk': 'MOCKUP#' },
        Limit: 100,
      }));
      items = (result.Items ?? []) as Record<string, unknown>[];
    }

    // Generate presigned URLs for each mockup
    const mockups = await Promise.all(
      items.map(async (item) => {
        const frontUrl = item.frontImageS3Key
          ? await getPresignedUrl(item.frontImageS3Key as string).catch(() => null)
          : null;
        const backUrl = item.backImageS3Key
          ? await getPresignedUrl(item.backImageS3Key as string).catch(() => null)
          : null;

        return {
          id: item.id,
          patternId: item.patternId,
          garmentType: item.garmentType,
          placementZone: item.placementZone,
          status: item.status,
          publishStatus: item.publishStatus,
          createdAt: item.createdAt,
          createdBy: item.createdBy,
          rejectionReason: item.rejectionReason,
          frontImageUrl: frontUrl,
          backImageUrl: backUrl,
          scalingPercentage: item.scalingPercentage,
        };
      })
    );

    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: JSON.stringify({ mockups, count: mockups.length }),
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    console.error(JSON.stringify({ type: 'MOCKUP_LIST_ERROR', error: message }));
    return errorResponse(500, message);
  }
};
