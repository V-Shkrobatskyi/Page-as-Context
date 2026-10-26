// Copyright (c) 2026 Vitalii Shkrobatskyi
// SPDX-License-Identifier: GPL-3.0-only
export const MCP_DATA_TYPES = ['websiteContent', 'browsingActivity', 'personalCommunications'] as const;
export const MCP_WRITE_DATA_TYPES = [...MCP_DATA_TYPES, 'websiteActivity'] as const;
