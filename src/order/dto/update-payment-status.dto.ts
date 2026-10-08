import { IsEnum } from 'class-validator';

/**
 * Admin review outcomes only — PENDING is the schema default and is restored by
 * the client re-upload flow, never set through this endpoint.
 */
export enum PaymentStatusDecision {
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
}

export class UpdatePaymentStatusDto {
  @IsEnum(PaymentStatusDecision)
  payment_status: PaymentStatusDecision;
}
