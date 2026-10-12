import { createModels } from "@earendil-works/pi-ai/models";
import { openrouterProvider } from "@earendil-works/pi-ai/providers/openrouter";

export const MODEL = "anthropic/claude-haiku-5.5";

export function openBrowserModel(apiKey: string) {
  const provider = openrouterProvider();
  const models = createModels({ authContext: { env: async () => undefined, fileExists: async () => false } });
  const browserModels = () => provider.getModels().map(model => model.id === MODEL
    ? { ...model, api: "openai-completions" as const, baseUrl: "https://openrouter.ai/api/v1", compat: {} }
    : model);
  models.setProvider({ ...provider, getModels: browserModels, getAllModels: browserModels,
    auth: { apiKey: { name: "OpenRouter API key", resolve: async () => apiKey ? { auth: { apiKey } } : undefined } } });
  const model = models.getModel("openrouter", MODEL);
  if (!model) throw new Error(`Browser model ${MODEL} is absent from the pinned Pi catalog. Restore the pinned dependencies and rebuild.`);
  return { models, model };
}
