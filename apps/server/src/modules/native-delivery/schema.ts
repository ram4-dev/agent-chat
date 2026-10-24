import { z } from 'zod';
export const nativeTicketSchema = z.object({ eventId: z.string().uuid(), claim: z.string().uuid(), controllerId: z.string().uuid(), epoch: z.number().int().positive() }).strict();
export const nativeResultSchema = z.object({ decision: z.enum(['reply','no_reply']), text: z.string().max(4000), conversationRef: z.string().min(1).max(500) }).strict();
export const nativeProofSchema = z.object({ data: z.object({ eventId: z.string().uuid(), targetId: z.string().uuid(), startKey: z.string().uuid(), runRef: z.string().min(1).max(500),
  terminal: z.enum(['completed','cancelled']), resultHash: z.string().regex(/^[a-f0-9]{64}$/).nullable() }).strict(), signature: z.string().min(1).max(200) }).strict();
