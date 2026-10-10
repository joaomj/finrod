export type ReplyMetadata = {
  requestId: string;
  conversationId: number;
  submissionId: number;
  answerEntryId: number;
  provider: string;
  model: string;
};

export type AssistantReply = {
  text: string;
  metadata: ReplyMetadata;
};
