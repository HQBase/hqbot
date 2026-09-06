export type ComputerPolicy = "autonomous" | "review" | "allow";
export interface ComputerReview {
  title: string;
  reason: string;
  details: string;
  decision: "allow" | "review";
  unavailable?: boolean;
}
export interface ComputerApproval {
  executionId: string;
  action: string;
  input: unknown;
  inputHash: string;
  review?: ComputerReview;
}
