import { describe, it, expect, beforeEach } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import { DynamoDBDocumentClient, PutCommand, GetCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import {
  putPattern,
  getPattern,
  queryPatterns,
  putTemplate,
  getTemplate,
  putGradingTable,
  getGradingTable,
} from '../../../src/db/operations.js';
import type { PatternMetadata, ParametricTemplate, GradingIncrementTable } from '../../../src/types/pattern.js';

// ---------------------------------------------------------------------------
// AWS SDK mock
// ---------------------------------------------------------------------------

const ddbMock = mockClient(DynamoDBDocumentClient);

beforeEach(() => {
  ddbMock.reset();
});

// ---------------------------------------------------------------------------
// Test Data
// ---------------------------------------------------------------------------

const samplePattern: PatternMetadata = {
  id: 'pat-001',
  garmentType: 'camiseta',
  ageGroup: 'adult',
  size: 'M',
  createdAt: '2024-01-15T10:30:00.000Z',
  generationMethod: 'parameters',
  s3Key: 'patterns/pat-001/pattern.svg',
  pieceCount: 4,
  seamAllowance: 15,
  adminId: 'admin-123',
};

const sampleTemplate: ParametricTemplate = {
  id: 'tmpl-001',
  garmentType: 'camiseta',
  ageGroup: 'adult',
  proportionProfile: {
    ageGroup: 'adult',
    headToBodyRatio: 0.133,
    limbToTorsoRatio: 1.2,
    waistPositionRatio: 0.42,
    shoulderToHipRatio: 1.1,
  },
  pieces: [],
  controlPoints: [
    { id: 'cp1', name: 'Chest Width', x: 0, y: 100, minValue: 400, maxValue: 1400, affectedPieces: ['front'] },
    { id: 'cp2', name: 'Waist Width', x: 0, y: 200, minValue: 350, maxValue: 1200, affectedPieces: ['front'] },
    { id: 'cp3', name: 'Hip Width', x: 0, y: 300, minValue: 400, maxValue: 1400, affectedPieces: ['front'] },
    { id: 'cp4', name: 'Torso Length', x: 0, y: 400, minValue: 300, maxValue: 900, affectedPieces: ['front'] },
  ],
  pieceDefinitions: [],
  defaultMeasurements: { cp1: 960, cp2: 800, cp3: 1000, cp4: 600 },
  constraints: [],
};

const sampleGradingTable: GradingIncrementTable = {
  garmentType: 'camiseta',
  ageGroup: 'adult',
  increments: {
    'XS→S': { cp1: 20, cp2: 20, cp3: 20, cp4: 5 },
    'S→M': { cp1: 20, cp2: 20, cp3: 20, cp4: 5 },
    'M→L': { cp1: 25, cp2: 25, cp3: 25, cp4: 5 },
    'L→XL': { cp1: 30, cp2: 30, cp3: 30, cp4: 8 },
  },
};

// ---------------------------------------------------------------------------
// putPattern / getPattern
// ---------------------------------------------------------------------------

describe('putPattern', () => {
  it('should store pattern metadata with correct key structure', async () => {
    ddbMock.on(PutCommand).resolves({});

    await putPattern(samplePattern);

    const calls = ddbMock.commandCalls(PutCommand);
    expect(calls).toHaveLength(1);

    const item = calls[0].args[0].input.Item;
    expect(item).toMatchObject({
      PK: 'PATTERN#pat-001',
      SK: 'METADATA',
      GSI1PK: 'PATTERNS',
      GSI1SK: '2024-01-15T10:30:00.000Z',
      id: 'pat-001',
      garmentType: 'camiseta',
      ageGroup: 'adult',
      size: 'M',
      createdAt: '2024-01-15T10:30:00.000Z',
      generationMethod: 'parameters',
      s3Key: 'patterns/pat-001/pattern.svg',
      pieceCount: 4,
      seamAllowance: 15,
      adminId: 'admin-123',
    });
  });
});

describe('getPattern', () => {
  it('should retrieve pattern metadata by ID', async () => {
    ddbMock.on(GetCommand).resolves({
      Item: {
        PK: 'PATTERN#pat-001',
        SK: 'METADATA',
        GSI1PK: 'PATTERNS',
        GSI1SK: '2024-01-15T10:30:00.000Z',
        ...samplePattern,
      },
    });

    const result = await getPattern('pat-001');

    expect(result).toEqual(samplePattern);

    const calls = ddbMock.commandCalls(GetCommand);
    expect(calls[0].args[0].input.Key).toEqual({
      PK: 'PATTERN#pat-001',
      SK: 'METADATA',
    });
  });

  it('should return null when pattern not found', async () => {
    ddbMock.on(GetCommand).resolves({ Item: undefined });

    const result = await getPattern('nonexistent');

    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// queryPatterns
// ---------------------------------------------------------------------------

describe('queryPatterns', () => {
  it('should query GSI1 with PATTERNS pk in descending order', async () => {
    ddbMock.on(QueryCommand).resolves({
      Items: [
        { PK: 'PATTERN#p2', SK: 'METADATA', GSI1PK: 'PATTERNS', GSI1SK: '2024-01-16T00:00:00.000Z', ...samplePattern, id: 'p2' },
        { PK: 'PATTERN#p1', SK: 'METADATA', GSI1PK: 'PATTERNS', GSI1SK: '2024-01-15T00:00:00.000Z', ...samplePattern, id: 'p1' },
      ],
      Count: 2,
    });

    const result = await queryPatterns();

    expect(result.patterns).toHaveLength(2);
    expect(result.count).toBe(2);

    const calls = ddbMock.commandCalls(QueryCommand);
    expect(calls[0].args[0].input.IndexName).toBe('GSI1');
    expect(calls[0].args[0].input.ScanIndexForward).toBe(false);
    expect(calls[0].args[0].input.KeyConditionExpression).toContain('GSI1PK = :pk');
  });

  it('should apply garmentType filter when provided', async () => {
    ddbMock.on(QueryCommand).resolves({ Items: [], Count: 0 });

    await queryPatterns({ garmentType: 'legging' });

    const calls = ddbMock.commandCalls(QueryCommand);
    expect(calls[0].args[0].input.FilterExpression).toContain('#garmentType = :garmentType');
    expect(calls[0].args[0].input.ExpressionAttributeValues).toMatchObject({ ':garmentType': 'legging' });
  });

  it('should apply ageGroup filter when provided', async () => {
    ddbMock.on(QueryCommand).resolves({ Items: [], Count: 0 });

    await queryPatterns({ ageGroup: 'children' });

    const calls = ddbMock.commandCalls(QueryCommand);
    expect(calls[0].args[0].input.FilterExpression).toContain('#ageGroup = :ageGroup');
    expect(calls[0].args[0].input.ExpressionAttributeValues).toMatchObject({ ':ageGroup': 'children' });
  });

  it('should apply both filters when both provided', async () => {
    ddbMock.on(QueryCommand).resolves({ Items: [], Count: 0 });

    await queryPatterns({ garmentType: 'short', ageGroup: 'adult' });

    const calls = ddbMock.commandCalls(QueryCommand);
    expect(calls[0].args[0].input.FilterExpression).toBe('#garmentType = :garmentType AND #ageGroup = :ageGroup');
  });

  it('should respect limit option', async () => {
    ddbMock.on(QueryCommand).resolves({ Items: [], Count: 0 });

    await queryPatterns({ limit: 10 });

    const calls = ddbMock.commandCalls(QueryCommand);
    expect(calls[0].args[0].input.Limit).toBe(10);
  });

  it('should pass exclusiveStartKey for pagination', async () => {
    const startKey = { PK: 'PATTERN#old', SK: 'METADATA', GSI1PK: 'PATTERNS', GSI1SK: '2024-01-01T00:00:00.000Z' };
    ddbMock.on(QueryCommand).resolves({ Items: [], Count: 0 });

    await queryPatterns({ exclusiveStartKey: startKey });

    const calls = ddbMock.commandCalls(QueryCommand);
    expect(calls[0].args[0].input.ExclusiveStartKey).toEqual(startKey);
  });
});

// ---------------------------------------------------------------------------
// putTemplate / getTemplate
// ---------------------------------------------------------------------------

describe('putTemplate', () => {
  it('should store the full template with correct key structure', async () => {
    ddbMock.on(PutCommand).resolves({});

    await putTemplate(sampleTemplate);

    const calls = ddbMock.commandCalls(PutCommand);
    expect(calls).toHaveLength(1);

    const item = calls[0].args[0].input.Item;
    expect(item).toMatchObject({
      PK: 'TEMPLATE#tmpl-001',
      SK: 'METADATA',
      id: 'tmpl-001',
      template: sampleTemplate,
    });
    expect(item?.createdAt).toBeDefined();
  });
});

describe('getTemplate', () => {
  it('should retrieve the full template by ID', async () => {
    ddbMock.on(GetCommand).resolves({
      Item: {
        PK: 'TEMPLATE#tmpl-001',
        SK: 'METADATA',
        id: 'tmpl-001',
        template: sampleTemplate,
        createdAt: '2024-01-15T10:00:00.000Z',
      },
    });

    const result = await getTemplate('tmpl-001');

    expect(result).toEqual(sampleTemplate);

    const calls = ddbMock.commandCalls(GetCommand);
    expect(calls[0].args[0].input.Key).toEqual({
      PK: 'TEMPLATE#tmpl-001',
      SK: 'METADATA',
    });
  });

  it('should return null when template not found', async () => {
    ddbMock.on(GetCommand).resolves({ Item: undefined });

    const result = await getTemplate('nonexistent');

    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// putGradingTable / getGradingTable
// ---------------------------------------------------------------------------

describe('putGradingTable', () => {
  it('should store grading table with correct composite key', async () => {
    ddbMock.on(PutCommand).resolves({});

    await putGradingTable('adult', 'camiseta', sampleGradingTable);

    const calls = ddbMock.commandCalls(PutCommand);
    expect(calls).toHaveLength(1);

    const item = calls[0].args[0].input.Item;
    expect(item).toMatchObject({
      PK: 'GRADINGTABLE#adult#camiseta',
      SK: 'METADATA',
      ageGroup: 'adult',
      garmentType: 'camiseta',
      table: sampleGradingTable,
    });
    expect(item?.createdAt).toBeDefined();
  });

  it('should use children age group in key', async () => {
    ddbMock.on(PutCommand).resolves({});

    await putGradingTable('children', 'short', sampleGradingTable);

    const calls = ddbMock.commandCalls(PutCommand);
    const item = calls[0].args[0].input.Item;
    expect(item?.PK).toBe('GRADINGTABLE#children#short');
  });
});

describe('getGradingTable', () => {
  it('should retrieve grading table by age group and garment type', async () => {
    ddbMock.on(GetCommand).resolves({
      Item: {
        PK: 'GRADINGTABLE#adult#camiseta',
        SK: 'METADATA',
        ageGroup: 'adult',
        garmentType: 'camiseta',
        table: sampleGradingTable,
        createdAt: '2024-01-15T10:00:00.000Z',
      },
    });

    const result = await getGradingTable('adult', 'camiseta');

    expect(result).toEqual(sampleGradingTable);

    const calls = ddbMock.commandCalls(GetCommand);
    expect(calls[0].args[0].input.Key).toEqual({
      PK: 'GRADINGTABLE#adult#camiseta',
      SK: 'METADATA',
    });
  });

  it('should return null when grading table not found', async () => {
    ddbMock.on(GetCommand).resolves({ Item: undefined });

    const result = await getGradingTable('children', 'legging');

    expect(result).toBeNull();
  });
});
