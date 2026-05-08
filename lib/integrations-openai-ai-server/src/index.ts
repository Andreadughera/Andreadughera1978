export const openai = {
  chat: {
    completions: {
      async create(_params?: unknown): Promise<{ choices: Array<{ message?: { content?: string | null } }> }> {
        throw new Error("OpenAI integration is not configured in this deployment");
      },
    },
  },
};
