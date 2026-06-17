---
name: prompt-engineering
description: Use this skill when writing prompts, commands, hooks, or skills for AI agents, sub agents, or any other programmatic LLM interactions, including optimizing prompts, improving LLM outputs, or designing production prompt templates.
---

# Prompt Engineering Patterns

Advanced prompt engineering techniques to maximize LLM performance, reliability, and controllability.

## Core Capabilities

### 1. Few-Shot Learning

Teach the model by showing examples instead of explaining rules. Include 2-5 input-output pairs that demonstrate the desired behavior. Use when you need consistent formatting, specific reasoning patterns, or handling of edge cases. More examples improve accuracy but consume tokens—balance based on task complexity.

**Example:**

```markdown
Extract key information from support tickets:

Input: "My login doesn't work and I keep getting error 403"
Output: {"issue": "authentication", "error_code": "403", "priority": "high"}

Input: "Feature request: add dark mode to settings"
Output: {"issue": "feature_request", "error_code": null, "priority": "low"}

Now process: "Can't upload files larger than 10MB, getting timeout"
```

### 2. Chain-of-Thought Prompting

Request step-by-step reasoning before the final answer. Add "Let's think step by step" (zero-shot) or include example reasoning traces (few-shot). Use for complex problems requiring multi-step logic, mathematical reasoning, or when you need to verify the model's thought process. Improves accuracy on analytical tasks markedly.

**Example:**

```markdown
Analyze this bug report and determine root cause.

Think step by step:
1. What is the expected behavior?
2. What is the actual behavior?
3. What changed recently that could cause this?
4. What components are involved?
5. What is the most likely root cause?

Bug: "Users can't save drafts after the cache update deployed yesterday"
```

### 3. Prompt Optimization

Systematically improve prompts through testing and refinement. Start simple, measure performance (accuracy, consistency, token usage), then iterate. Test on diverse inputs including edge cases. Use A/B testing to compare variations. Critical for production prompts where consistency and cost matter.

**Example:**

```markdown
Version 1 (Simple): "Summarize this article"
→ Result: Inconsistent length, misses key points

Version 2 (Add constraints): "Summarize in 3 bullet points"
→ Result: Better structure, but still misses nuance

Version 3 (Add reasoning): "Identify the 3 main findings, then summarize each"
→ Result: Consistent, accurate, captures key information
```

### 4. Template Systems

Build reusable prompt structures with variables, conditional sections, and modular components. Use for multi-turn conversations, role-based interactions, or when the same pattern applies to different inputs. Reduces duplication and ensures consistency across similar tasks.

**Example:**

```
# Reusable code review template, with placeholders filled per invocation
Review this {language} code for {focus_area}.

Code:
{code_block}

Provide feedback on:
{checklist}
```

Filling `{language}`, `{focus_area}`, `{code_block}`, and `{checklist}` per call keeps every review prompt consistent while varying only what must change.

### 5. System Prompt Design

Set global behavior and constraints that persist across the conversation. Define the model's role, expertise level, output format, and safety guidelines. Use system prompts for stable instructions that shouldn't change turn-to-turn, freeing up user message tokens for variable content.

**Example:**

```markdown
System: You are a senior backend engineer specializing in API design.

Rules:
- Always consider scalability and performance
- Suggest RESTful patterns by default
- Flag security concerns immediately
- Provide concrete code examples
- Use the early-return pattern

Format responses as:
1. Analysis
2. Recommendation
3. Code example
4. Trade-offs
```

## Key Patterns

### Progressive Disclosure

Start with simple prompts, add complexity only when needed:

1. **Level 1**: Direct instruction
    - "Summarize this article"

2. **Level 2**: Add constraints
    - "Summarize this article in 3 bullet points, focusing on key findings"

3. **Level 3**: Add reasoning
    - "Read this article, identify the main findings, then summarize in 3 bullet points"

4. **Level 4**: Add examples
    - Include 2-3 example summaries with input-output pairs

### Instruction Hierarchy

```
[System Context] → [Task Instruction] → [Examples] → [Input Data] → [Output Format]
```

### Error Recovery

Build prompts that gracefully handle failures:

- Include fallback instructions
- Request confidence scores
- Ask for alternative interpretations when uncertain
- Specify how to indicate missing information

## Best Practices

1. **Be Specific**: Vague prompts produce inconsistent results
2. **Show, Don't Tell**: Examples are more effective than descriptions
3. **Test Extensively**: Evaluate on diverse, representative inputs
4. **Iterate Rapidly**: Small changes can have large impacts
5. **Monitor Performance**: Track metrics in production
6. **Version Control**: Treat prompts as code with proper versioning
7. **Document Intent**: Explain why prompts are structured as they are

## Common Pitfalls

- **Over-engineering**: Starting with complex prompts before trying simple ones
- **Example pollution**: Using examples that don't match the target task
- **Context overflow**: Exceeding token limits with excessive examples
- **Ambiguous instructions**: Leaving room for multiple interpretations
- **Ignoring edge cases**: Not testing on unusual or boundary inputs
- **Corpus overfitting**: Tuning a prompt with examples drawn from one subject area silently makes it worse on every other. Teach with principles; where an example clarifies, choose a neutral or deliberately cross-domain one.

## Integration Patterns

### With Retrieval (RAG)

```
Given the following context:
{retrieved_context}

{few_shot_examples}

Question: {user_question}

Provide a detailed answer based solely on the context above. If the context
doesn't contain enough information, explicitly state what's missing.
```

### With Validation

```
{main_task_prompt}

After generating your response, verify it meets these criteria:
1. Answers the question directly
2. Uses only information from provided context
3. Cites specific sources
4. Acknowledges any uncertainty

If verification fails, revise your response.
```

## Performance Optimization

### Token Efficiency

- Remove redundant words and phrases
- Use abbreviations consistently after first definition
- Consolidate similar instructions
- Move stable content to system prompts

### Latency Reduction

- Minimize prompt length without sacrificing quality
- Use streaming for long-form outputs
- Cache common prompt prefixes
- Batch similar requests when possible

---

# Agent Prompting Best Practices

## Core principles

### Context Window

The "context window" refers to the entirety of the text a language model can look back on and reference when generating new text, plus the new text it generates. This is different from the large corpus the model was trained on; it represents the model's "working memory." A larger context window lets the model understand longer prompts and stay coherent over extended conversations; a smaller one limits both.

- **Progressive token accumulation**: as the conversation advances through turns, each user message and model response accumulates within the context window. Previous turns are preserved completely.
- **Linear growth pattern**: context usage grows linearly with each turn.
- **Finite capacity**: every model has a maximum context size (it varies by model and version). Treat it as a fixed budget shared by the whole conversation, and check the limit for the specific model you target rather than assuming a number.
- **Input-output flow**: each turn consists of an input phase (all previous history plus the current message) and an output phase (the response, which becomes part of a future input).

### Concise is key

The context window is a public good. Your prompt, command, or skill shares the context window with everything else the model needs, including:

- The system prompt
- Conversation history
- Other commands, skills, hooks, metadata
- The actual request

**Default assumption**: the model is already very capable.

Only add context the model doesn't already have. Challenge each piece of information:

- "Does the model really need this explanation?"
- "Can I assume the model knows this?"
- "Does this paragraph justify its token cost?"

**Good example: concise** (~50 tokens):

````markdown
## Extract text from a document

Use the project's standard document-parsing library:

```
open the file → read the first page → extract its text
```
````

**Bad example: too verbose** (~150 tokens):

```markdown
## Extract text from a document

Documents are a common file format that contain text, images, and other
content. To extract text, you'll need to use a library. There are many
libraries available, but we recommend one because it's easy to use and handles
most cases well. First, install it. Then you can use the code below...
```

The concise version assumes the model knows what documents are and how libraries work.

### Set appropriate degrees of freedom

Match the level of specificity to the task's fragility and variability.

**High freedom** (text-based instructions) — use when multiple approaches are valid, decisions depend on context, or heuristics guide the approach:

```markdown
## Code review process

1. Analyze the code structure and organization
2. Check for potential bugs or edge cases
3. Suggest improvements for readability and maintainability
4. Verify adherence to project conventions
```

**Medium freedom** (pseudocode or scripts with parameters) — use when a preferred pattern exists, some variation is acceptable, or configuration affects behavior:

````markdown
## Generate report

Use this template and customize as needed:

```
generate_report(data, format = "markdown", include_charts = true):
    process the data
    render output in the chosen format
    optionally include visualizations
```
````

**Low freedom** (specific commands, few or no parameters) — use when operations are fragile, consistency is critical, or an exact sequence must be followed:

````markdown
## Database migration

Run exactly this command:

```
<project migration command> --verify --backup
```

Do not modify the command or add additional flags.
````

**Analogy**: think of the agent as a robot exploring a path:

- **Narrow bridge with cliffs on both sides**: only one safe way forward. Provide specific guardrails and exact instructions (low freedom). Example: migrations that must run in an exact sequence.
- **Open field with no hazards**: many paths lead to success. Give general direction and trust the agent to find the best route (high freedom). Example: code reviews where context determines the best approach.

---

# Persuasion Principles for Agent Communication

Useful for writing prompts of all kinds: commands, hooks, skills, sub-agent instructions, or any other LLM interaction.

## Overview

LLMs respond to the same persuasion principles as humans. Understanding this psychology helps you design more effective skills — not to manipulate, but to ensure critical practices are followed even under pressure.

**Research foundation:** Meincke et al. (2025) tested 7 persuasion principles across roughly 28,000 AI conversations. Persuasion techniques more than doubled compliance rates (33% → 72%, p < .001).

## The Seven Principles

### 1. Authority

**What it is:** deference to expertise, credentials, or official sources.

**How it works in prompts:**

- Imperative language: "YOU MUST", "Never", "Always"
- Non-negotiable framing: "No exceptions"
- Eliminates decision fatigue and rationalization

**When to use:** discipline-enforcing skills (TDD, verification requirements), safety-critical practices, established best practices.

**Example:**

```markdown
✅ Write code before the test? Delete it. Start over. No exceptions.
❌ Consider writing tests first when feasible.
```

### 2. Commitment

**What it is:** consistency with prior actions, statements, or public declarations.

**How it works in prompts:**

- Require announcements: "Announce skill usage"
- Force explicit choices: "Choose A, B, or C"
- Use tracking: a checklist the agent ticks off

**When to use:** ensuring skills are actually followed, multi-step processes, accountability mechanisms.

**Example:**

```markdown
✅ When you find a skill, you MUST announce: "I'm using [Skill Name]"
❌ Consider letting your partner know which skill you're using.
```

### 3. Scarcity

**What it is:** urgency from time limits or limited availability.

**How it works in prompts:**

- Time-bound requirements: "Before proceeding"
- Sequential dependencies: "Immediately after X"
- Prevents procrastination

**When to use:** immediate verification requirements, time-sensitive workflows, preventing "I'll do it later".

**Example:**

```markdown
✅ After completing a task, IMMEDIATELY request code review before proceeding.
❌ You can review code when convenient.
```

### 4. Social Proof

**What it is:** conformity to what others do or what's considered normal.

**How it works in prompts:**

- Universal patterns: "Every time", "Always"
- Failure modes: "X without Y = failure"
- Establishes norms

**When to use:** documenting universal practices, warning about common failures, reinforcing standards.

**Example:**

```markdown
✅ Checklists without explicit tracking = steps get skipped. Every time.
❌ Some people find a checklist helpful.
```

### 5. Unity

**What it is:** shared identity, "we-ness", in-group belonging.

**How it works in prompts:**

- Collaborative language: "our codebase", "we're colleagues"
- Shared goals: "we both want quality"

**When to use:** collaborative workflows, establishing team culture, non-hierarchical practices.

**Example:**

```markdown
✅ We're colleagues working together. I need your honest technical judgment.
❌ You should probably tell me if I'm wrong.
```

### 6. Reciprocity

**What it is:** obligation to return benefits received.

**How it works:** use sparingly — can feel manipulative; rarely needed in prompts.

**When to avoid:** almost always (other principles are more effective).

### 7. Liking

**What it is:** preference for cooperating with those we like.

**How it works:** **don't use for compliance.** Conflicts with an honest-feedback culture and creates sycophancy.

**When to avoid:** always, for discipline enforcement.

## Principle Combinations by Prompt Type

| Prompt Type | Use | Avoid |
|------------|-----|-------|
| Discipline-enforcing | Authority + Commitment + Social Proof | Liking, Reciprocity |
| Guidance/technique | Moderate Authority + Unity | Heavy authority |
| Collaborative | Unity + Commitment | Authority, Liking |
| Reference | Clarity only | All persuasion |

## Why This Works: The Psychology

**Bright-line rules reduce rationalization:**

- "YOU MUST" removes decision fatigue
- Absolute language eliminates "is this an exception?" questions
- Explicit anti-rationalization closes specific loopholes

**Implementation intentions create automatic behavior:**

- Clear triggers + required actions = automatic execution
- "When X, do Y" is more effective than "generally do Y"
- Reduces cognitive load on compliance

**LLMs are parahuman:**

- Trained on human text containing these patterns
- Authority language precedes compliance in training data
- Commitment sequences (statement → action) are frequently modeled
- Social-proof patterns (everyone does X) establish norms

## Ethical Use

**Legitimate:** ensuring critical practices are followed, creating effective documentation, preventing predictable failures.

**Illegitimate:** manipulating for personal gain, creating false urgency, guilt-based compliance.

**The test:** would this technique serve the user's genuine interests if they fully understood it?

## Quick Reference

When designing a prompt, ask:

1. **What type is it?** (discipline vs. guidance vs. reference)
2. **What behavior am I trying to change?**
3. **Which principle(s) apply?** (usually authority + commitment for discipline)
4. **Am I combining too many?** (don't use all seven)
5. **Is this ethical?** (serves the user's genuine interests?)
