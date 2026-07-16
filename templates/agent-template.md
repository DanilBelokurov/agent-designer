---
name: agent-name
description: Краткое описание того, когда и как использовать этого агента
model: inherit   # Опционально: inherit, fast, modelId или authType:modelId
approvalMode: auto-edit   # Опционально: default, plan, auto-edit, yolo, bubble
tools:           # Опционально: белый список инструментов
  - tool1
  - tool2
disallowedTools: # Опционально: чёрный список инструментов
  - tool3
---
Содержимое системного промпта.
Поддерживаются несколько абзацев.
