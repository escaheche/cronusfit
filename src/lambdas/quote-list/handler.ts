/**
 * Quote List Lambda Handler
 *
 * GET /api/quotes?status={status} — Admin endpoint (JWT required).
 * Returns a list of quote summaries for the admin panel.
 */

import type { APIGatewayProxyHandler, APIGatewayProxyResult } from 'aws-lambda';
import { queryByGSI1 } from '../../db/operations.js';
import type { QuoteRecord, QuoteStatus } from '../../db/entities.js';

const ALLOWED_STATUSES: QuoteStatus[] = ['pending', 'quoted', 'accepted', 'rejected'];

const CORS_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization',
  'Access-Control-Allow-Methods': 'GET,OPTIONS',
};

export const handler: APIGatewayProxyHandler = async (event): Promise<APIGatewayProxyResult> => {
  try {
    if (event.httpMethod !== 'GET') {
      return errorResponse(405, 'Method not allowed. Use GET.');
    }

    const statusFilter = event.queryStringParameters?.status;
    if (statusFilter && !ALLOWED_STATUSES.includes(statusFilter as QuoteStatus)) {
      return errorResponse(400, 'Invalid status filter');
    }

    const statuses = statusFilter
      ? [statusFilter as QuoteStatus]
      : ALLOWED_STATUSES;

    const results = await Promise.all(
      statuses.map((status) =>
        queryByGSI1<QuoteRecord>(
          `QSTATUS#${status}`,
          undefined,
          {
            scanIndexForward: false,
            limit: 500,
          },
        ),
      ),
    );

    const quotes = results
      .flatMap((result) => result.items)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: JSON.stringify(quotes.map(mapQuoteRecord)),
    };
  } catch (error: unknown) {
    console.error(
      JSON.stringify({
        type: 'QUOTE_LIST_UNHANDLED_ERROR',
        error: error instanceof Error ? error.message : String(error),
        timestamp: new Date().toISOString(),
      }),
    );
    return errorResponse(500, 'Internal server error');
  }
};

function mapQuoteRecord(record: QuoteRecord) {
  return {
    id: record.id,
    trackingNumber: record.trackingNumber,
    clientName: record.clientName,
    product: record.productName,
    productId: record.productId,
    quantity: record.quantity,
    sizes: record.sizes,
    status: record.status,
    receivedAt: record.createdAt,
    updatedAt: record.updatedAt,
    contactInfo: {
      email: record.email,
      phone: record.phone,
    },
    notes: record.customizationNotes,
    price: record.totalPrice,
    currency: record.currency,
    validUntil: record.validUntil,
    statusHistory: [
      {
        status: record.status,
        changedAt: record.updatedAt ?? record.createdAt,
      },
    ],
  };
}

function errorResponse(statusCode: number, message: string): APIGatewayProxyResult {
  return {
    statusCode,
    headers: CORS_HEADERS,
    body: JSON.stringify({ message }),
  };
}
