// Copyright (c) 2024-2026 Tencent Zhuque Lab. All rights reserved.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.
//
// Requirement: Any integration or derivative work must explicitly attribute
// Tencent Zhuque Lab (https://github.com/Tencent/AI-Infra-Guard) in its
// documentation or user interface, as detailed in the NOTICE file.

package agent

import (
	"context"
	"encoding/json"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

type mockDispatchTask struct {
	name     string
	executed chan struct{}
}

func (m *mockDispatchTask) GetName() string {
	return m.name
}

func (m *mockDispatchTask) Execute(_ context.Context, _ TaskRequest, _ TaskCallbacks) error {
	select {
	case <-m.executed:
	default:
		close(m.executed)
	}
	return nil
}

func TestTaskGetNameMappings(t *testing.T) {
	assert.Equal(t, TaskTypeAIInfraScan, (&AIInfraScanAgent{}).GetName())
	assert.Equal(t, TaskTypeMcpScan, (&McpTask{}).GetName())
	assert.Equal(t, TaskTypeModelRedteamReport, (&ModelRedteamReport{}).GetName())
	assert.Equal(t, TaskTypeAgentScan, (&AgentTask{}).GetName())
	assert.Equal(t, TaskTypeGarakScan, (&GarakTask{}).GetName())
}

func TestProcessMessageDispatchesGarakTask(t *testing.T) {
	a := NewAgent(AgentConfig{ServerURL: "ws://127.0.0.1:0", Info: AgentInfo{ID: "test"}})
	garakTask := &mockDispatchTask{name: TaskTypeGarakScan, executed: make(chan struct{})}
	otherTask := &mockDispatchTask{name: TaskTypeMcpScan, executed: make(chan struct{})}
	a.RegisterTaskFunc(otherTask)
	a.RegisterTaskFunc(garakTask)

	taskReq := TaskRequest{
		SessionId: "session-garak-dispatch",
		TaskType:  TaskTypeGarakScan,
		Params:    json.RawMessage(`{"scan_target":"quick_check","intensity":"fast"}`),
		Content:   "",
	}
	data, err := json.Marshal(map[string]interface{}{
		"type":    ServerMsgTypeTaskAssign,
		"content": taskReq,
	})
	require.NoError(t, err)

	err = a.processMessage(data)
	require.NoError(t, err)

	select {
	case <-garakTask.executed:
		// expected
	case <-time.After(2 * time.Second):
		t.Fatal("expected Garak task to be dispatched and executed")
	}

	select {
	case <-otherTask.executed:
		t.Fatal("unexpected non-Garak task execution")
	default:
	}
}
