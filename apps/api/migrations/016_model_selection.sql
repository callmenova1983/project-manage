UPDATE model_settings SET data=json_set(data, '$.model', 'qwen3.8-max', '$.version', json_extract(data, '$.version') + 1) WHERE json_extract(data, '$.model')='qwen3.6-35b-a3b';
