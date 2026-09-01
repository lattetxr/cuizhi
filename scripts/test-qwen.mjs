/**
 * 千问 API 连接测试脚本
 * 用法：node scripts/test-qwen.mjs
 * 
 * 测试内容：
 * 1. 检查 .env 配置是否正确加载
 * 2. 测试千问 API 连通性（简单对话）
 * 3. 测试 JSON 模式输出（Agent 管线需要）
 * 4. 显示模型信息和耗时
 */

import 'dotenv/config';

const { LLM_BASE_URL, LLM_API_KEY, LLM_MODEL } = process.env;

function maskKey(key) {
  if (!key) return '(空)';
  return `${key.slice(0, 6)}...${key.slice(-4)}`;
}

async function callChat(messages, jsonMode = false) {
  const payload = {
    model: LLM_MODEL || 'qwen-plus',
    messages,
    temperature: 0.4,
  };
  if (jsonMode) payload.response_format = { type: 'json_object' };

  const start = Date.now();
  const response = await fetch(`${LLM_BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${LLM_API_KEY}`,
    },
    body: JSON.stringify(payload),
  });
  const elapsed = Date.now() - start;

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`HTTP ${response.status}: ${text.slice(0, 200)}`);
  }

  const data = await response.json();
  return {
    content: data?.choices?.[0]?.message?.content,
    usage: data?.usage,
    elapsed,
  };
}

async function main() {
  console.log('========================================');
  console.log('  千问 API 连接测试');
  console.log('========================================\n');

  // 1. 配置检查
  console.log('【1】配置检查');
  console.log(`  Base URL: ${LLM_BASE_URL || '(未设置，默认 OpenAI)'}`);
  console.log(`  API Key:  ${maskKey(LLM_API_KEY)}`);
  console.log(`  Model:    ${LLM_MODEL || '(未设置，默认 qwen-plus)'}`);

  if (!LLM_API_KEY) {
    console.log('\n❌ 未配置 LLM_API_KEY，请在 .env 中填入千问 API Key');
    console.log('   获取地址：https://dashscope.console.aliyun.com/apiKey');
    process.exit(1);
  }

  if (!LLM_BASE_URL?.includes('dashscope')) {
    console.log('\n⚠️  Base URL 不是千问地址，确认是否要测试千问？');
  }

  // 2. 简单对话测试
  console.log('\n【2】简单对话测试（"你好，请用一句话介绍你自己"）');
  try {
    const result = await callChat([
      { role: 'user', content: '你好，请用一句话介绍你自己。' },
    ]);
    console.log(`  ✅ 成功（${result.elapsed}ms）`);
    console.log(`  回复：${result.content?.slice(0, 100)}${result.content?.length > 100 ? '...' : ''}`);
    if (result.usage) {
      console.log(`  Token：prompt=${result.usage.prompt_tokens}, completion=${result.usage.completion_tokens}, total=${result.usage.total_tokens}`);
    }
  } catch (error) {
    console.log(`  ❌ 失败：${error.message}`);
    process.exit(1);
  }

  // 3. JSON 模式测试
  console.log('\n【3】JSON 模式测试（Agent 管线需要）');
  try {
    const result = await callChat(
      [
        { role: 'system', content: '你是一个 JSON 生成器，只输出合法 JSON。' },
        { role: 'user', content: '输出一个包含 name 和 age 字段的 JSON 对象。' },
      ],
      true,
    );
    console.log(`  ✅ 成功（${result.elapsed}ms）`);
    console.log(`  原始输出：${result.content?.slice(0, 100)}`);
    try {
      const parsed = JSON.parse(result.content);
      console.log(`  JSON 解析：✅ name=${parsed.name}, age=${parsed.age}`);
    } catch (e) {
      console.log(`  JSON 解析：⚠️ 失败（${e.message}），可能需要在 prompt 中加强约束`);
    }
  } catch (error) {
    console.log(`  ❌ 失败：${error.message}`);
    process.exit(1);
  }

  console.log('\n========================================');
  console.log('  ✅ 千问 API 连接测试全部通过！');
  console.log('  可以启动项目：npm start');
  console.log('========================================');
}

main().catch((error) => {
  console.error('\n❌ 测试脚本异常：', error);
  process.exit(1);
});
