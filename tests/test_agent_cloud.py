"""The assistant on a cloud model with the user's own key.

run() (the local Ollama path) is covered by tests/test_agent.py and is left
exactly as it was; run_cloud() is its twin through backend.chat().
"""

from llm.base import ChatTurn, LLMBackend, ToolCall
from server.agent import run_cloud

TOOLS = [{"name": "list_videos", "description": "List videos", "inputSchema": {"type": "object"}},
         {"name": "publish_plan", "description": "Plan", "inputSchema": {"type": "object"}}]


class Scripted(LLMBackend):
    name = "openrouter/meta/muse-spark-1.3"

    def __init__(self, turns):
        self.turns = list(turns)
        self.seen = []

    def generate(self, prompt, *, json_mode=False):
        raise AssertionError("the assistant chats, it does not generate")

    def chat(self, messages, tools):
        self.seen.append(([dict(m) for m in messages], tools))
        return self.turns.pop(0)


def test_it_calls_tools_then_answers():
    backend = Scripted([
        ChatTurn(tool_calls=[ToolCall(id="c1", name="list_videos", arguments={"limit": 5})], raw=["r1"]),
        ChatTurn(text="You have two videos."),
    ])
    ran = []

    def call_tool(name, args):
        ran.append((name, args))
        return "two videos", None

    result = run_cloud("what videos do I have?", [], TOOLS, call_tool, backend)
    assert result["reply"] == "You have two videos."
    assert result["model"] == "openrouter/meta/muse-spark-1.3"
    assert ran == [("list_videos", {"limit": 5})]
    assert result["steps"][0]["tool"] == "list_videos"

    second_messages, tools = backend.seen[1]
    assert second_messages[0]["role"] == "system"
    assistant, tool = second_messages[-2], second_messages[-1]
    assert assistant["raw"] == ["r1"] and assistant["tool_calls"][0]["id"] == "c1"
    assert tool == {"role": "tool", "tool_call_id": "c1", "name": "list_videos", "content": "two videos"}
    assert tools[0]["function"]["name"] == "list_videos"


def test_a_publish_plan_reaches_the_window():
    backend = Scripted([
        ChatTurn(tool_calls=[ToolCall(id="c1", name="publish_plan", arguments={})]),
        ChatTurn(text="Here is the plan."),
    ])
    result = run_cloud("publish them", [], TOOLS, lambda n, a: ("planned", {"items": [1]}), backend)
    assert result["plan"] == {"items": [1]}


def test_a_json_code_block_with_a_tool_call_is_dispatched():
    queue_tool = {
        "name": "queue_video",
        "description": "Queue a video",
        "inputSchema": {
            "type": "object",
            "properties": {
                "url": {"type": "string"},
                "max_clips": {"type": "integer"},
            },
            "required": ["url"],
        },
    }
    backend = Scripted([
        ChatTurn(text=(
            "```json\n[\n"
            "  \"queue_video(url='https://www.youtube.com/watch?v=6AkUxQylZo0', max_clips=3)\"\n"
            "]\n```"
        )),
        ChatTurn(text="Queued as job 42."),
    ])
    ran = []

    def call_tool(name, arguments):
        ran.append((name, arguments))
        return "Queued as job 42.", None

    result = run_cloud(
        "Clip this stream: https://www.youtube.com/watch?v=6AkUxQylZo0, 3 clips",
        [], [queue_tool], call_tool, backend,
    )

    assert ran == [("queue_video", {
        "url": "https://www.youtube.com/watch?v=6AkUxQylZo0",
        "max_clips": 3,
    })]
    assert result["reply"] == "Queued as job 42."
    assert result["steps"][0]["tool"] == "queue_video"
    assistant, tool = backend.seen[1][0][-2:]
    assert assistant["tool_calls"][0]["name"] == "queue_video"
    assert assistant["tool_calls"][0]["arguments"]["max_clips"] == 3
    assert tool["tool_call_id"] == assistant["tool_calls"][0]["id"]


def test_text_that_is_not_a_literal_known_tool_call_is_not_dispatched():
    queue_tool = {
        "name": "queue_video",
        "description": "Queue a video",
        "inputSchema": {
            "type": "object",
            "properties": {"url": {"type": "string"}},
            "required": ["url"],
        },
    }
    backend = Scripted([
        ChatTurn(text="""["queue_video(url=__import__('os').system('whoami'))"]"""),
    ])
    ran = []
    result = run_cloud("clip this", [], [queue_tool],
                       lambda name, arguments: ran.append((name, arguments)), backend)

    assert ran == []
    assert result["steps"] == []
    assert "queue_video" in result["reply"]


def test_earlier_turns_are_passed_as_plain_text():
    backend = Scripted([ChatTurn(text="ok")])
    run_cloud("and now?", [{"role": "user", "content": "hi"}, {"role": "assistant", "content": "hello"},
                           {"role": "tool", "content": "ignored"}], TOOLS, lambda n, a: ("", None), backend)
    messages = backend.seen[0][0]
    assert [m["role"] for m in messages] == ["system", "user", "assistant", "user"]


def test_an_empty_cloud_answer_says_so():
    from llm.base import ChatTurn

    class Silent:
        name = "openrouter/test"

        def chat(self, messages, tools):
            return ChatTurn(text="", tool_calls=[], raw=None)

    out = run_cloud("clip this", [], [], lambda *_a: ("", None), Silent())
    assert "didn't answer" in out["reply"]
