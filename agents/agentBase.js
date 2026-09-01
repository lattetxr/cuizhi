import { callStructuredJson } from '../server/lib/llm.js';
import { buildSourceContext } from './context.js';

export function createAgent({ name, schemaName, system, buildUser, mock }) {
  return {
    name,
    schemaName,
    async run(input) {
      const answers = input.answers || [];
      const ctx = buildSourceContext(answers);
      const result = await callStructuredJson({
        system: system(ctx, input),
        user: buildUser(ctx, input),
        schemaName,
        mockData: () => mock(input, ctx),
      });
      if (!result.ok) {
        return { ok: false, name, error: result.error };
      }
      return { ok: true, name, data: result.data, mock: result.mock };
    },
    mock,
  };
}
