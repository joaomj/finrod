/** Prompt files in server/prompts; the build bundles them as text. */
declare module "*.md" {
  const text: string;
  export default text;
}
