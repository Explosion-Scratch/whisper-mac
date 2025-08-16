Instead of the current method of transcribing and then processing in real time with VAD, record audio chunks and display a waveform animation in the dictation window as the user speaks. When the user is done speaking, they press the keyboard shortcut again, which sends the audio along with the prompts to the Gemini API as detailed below, including the audio, and then parses the JSON output. This means that you can remove a lot of the code for segments and flushing them If it's related to whether a segment is in progress or complete. It's still important to make sure that all audio gets handled, no matter when dictation is started or stopped, and that all text gets filled. Instead, the only handling will be a singular audio chunk, and then the user can send that and transcribe it. Think deeeply about how to integrate all of this - remove any code you don't need, revise settings, onboarding, etc to all reflect this new structure.

This will then be used to integrate an AI into this.

Gemini API example - convert to JS fetch:
#!/bin/bash
set -e -E

GEMINI_API_KEY="$GEMINI_API_KEY"
MODEL_ID="gemini-2.5-flash"
GENERATE_CONTENT_API="streamGenerateContent"

cat << EOF > request.json
{
"contents": [
{
"role": "user",
"parts": [
{
"text": "You are an expert text editor based on natural language instructions that the user speaks. The user will speak something (transcribed below) and your job is to polish it and follow any natural language instructions within. Do this based on shared context, the current text on the user's screen, the transcription of what the user is saying, and the active window/application context. Output in markdown. Keep the user's wording relatively intact, try to make as few changes as possible unless requested otherwise. Be aware for words and phrases that might sound identical to something else - These were likely transcribed wrong, e.g. \"UYUX\" probably is \"UI/UX\", or \"Function deep out. Takes weight\" means \"Function debounce, takes wait\". Beware that repetitions are likely the user correcting something previously said, e.g. \"QUINN332B QWEN332B\" should resolve to \"Qwen3-32B\". When you're confused think about the context this was said in. Don't use annoying formatting like bold words unless specifically requested. Additionally try to figure out what the correct capitalization and punctuation likely is and follow that, e.g. code component naming schemes or names of companies, etc. Only output the new changed text. E.g. the user may say \"dear boss I want a raise sincerely bob ok fix it\" and you could output:\n\n----EXAMPLE----\nHi [Manager's Name], I hope you're well. I'd like to schedule a brief meeting to discuss the possibility of a salary adjustment based on my contributions and responsibilities. Please let me know a convenient time for you.\n\nBest regards, Bob\n----END EXAMPLE----\n\nIf the ROUGH TRANSCRIPTION was \"Oh my gosh, I love how are you? Hello how are you? Is what I meant\"\n----EXAMPLE----\nOh my gosh hello how are you!!\n----END EXAMPLE----\n(This is because \"I love how are you\" does't make sense, but sounds semantically similar to \"Hello how are you\" which is clarified later)\n\nModify writing style based on the current context and these notes by the user:\n----WRITING STYLE NOTES----\nTranscription is mean to end up as a: Professional request for JS code\n----END WRITING STYLE NOTES----\n\nPerform these modifications based on the context, selection, transcription, and active window/application given.\n"
},
{
"inlineData": {
"mimeType": "audio/x-wav",
"data": "BASE64_ENCODED_AUDIO_DATA"
}
},
]
}
{
"role": "user",
"parts": [
{
"text": "INSERT_INPUT_HERE"
},
]
},
],
"generationConfig": {
"temperature": 0,
"thinkingConfig": {
"thinkingBudget": 0,
},
},
}
EOF

curl \
-X POST \
-H "Content-Type: application/json" \
"https://generativelanguage.googleapis.com/v1beta/models/${MODEL_ID}:${GENERATE_CONTENT_API}?key=${GEMINI_API_KEY}" -d '@request.json'
