# Task Analysis Prompt
## Role Description
${roleDescription}

## Behavior Guidelines
${behaviorGuidelines}

## Constraints
${constraints}

## Available Agents
${agentListJson}

## Conversation History
${historyText}

## User Input
${userInput}

## Return Format
You must return a JSON object with the following structure:
{
  "confidenceScore": number (0.0 to 1.0),
  "intentType": string,
  "refinedGoal": string (Refined clear goal description),
  "clarificationQuestions": string[] (If confidenceScore is low, list specific questions the user must answer),
  "subtasks": [
    {
      "id": "task_1",
      "description": "Clear description of the subtask",
      "assignedAgentId": "Must use one of the Agent IDs from the available Agent list above",
      "dependencies": [],
      "inputSources": ["user_input"]
    }
  ]
}

## Key Rules
1. **Agent ID Validation**: You must use the exact Agent ID from the available Agent list above. Do not invent, guess, or use an ID not in the list. Using an invalid ID will result in task failure.
2. **If confidenceScore >= 0.7**: Generate the subtasks array using valid Agent IDs from the list.
3. **If confidenceScore < 0.7**:
   - Set subtasks to an empty array []
   - Provide specific clarification questions that the user must answer
4. **If no suitable Agent is available**: Set subtasks to an empty array [] and indicate in clarificationQuestions that no suitable Agent is available.

Please only return valid JSON, without any additional text.
