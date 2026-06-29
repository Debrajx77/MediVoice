import { useMemo, useRef, useState } from "react";

const SYSTEM_PROMPT = `You are a calm, knowledgeable medical triage assistant. You are NOT a doctor and
you make that clear. Given a user's symptom description, respond ONLY as a valid
JSON object with this exact structure — no preamble, no markdown, no explanation:

{
  "possible_causes": "2–3 plain-English possibilities, no jargon, 2 sentences max",
  "urgency": "one of exactly: WAIT_AND_MONITOR | SEE_DOCTOR_THIS_WEEK | GO_NOW",
  "urgency_reason": "one sentence explaining why this urgency level",
  "action_now": "the single most useful thing the person can do right now",
  "bring_to_doctor": "3 bullet points of what info to collect or bring"
}

Rules:
- Never diagnose. Always say 'could be' or 'this may indicate'.
- If symptoms suggest heart attack, stroke, or severe allergic reaction, urgency is always GO_NOW.
- Keep every field under 60 words.
- Respond ONLY with the JSON. Nothing before or after it.`;

const URGENCY_STYLES = {
  WAIT_AND_MONITOR: {
    label: "Wait & Monitor",
    badge: "bg-green-100 text-green-900 ring-green-300",
    panel: "border-green-200 bg-green-50",
    dot: "bg-green-500",
  },
  SEE_DOCTOR_THIS_WEEK: {
    label: "See a Doctor This Week",
    badge: "bg-amber-100 text-amber-950 ring-amber-300",
    panel: "border-amber-200 bg-amber-50",
    dot: "bg-amber-500",
  },
  GO_NOW: {
    label: "Go Now",
    badge: "bg-red-100 text-red-950 ring-red-300",
    panel: "border-red-200 bg-red-50",
    dot: "bg-red-500",
  },
};

const fallbackError =
  "I could not read the AI response clearly. Please try again, or contact a medical professional if symptoms feel urgent.";

function normalizeBullets(value) {
  return String(value || "")
    .split(/\n|•|-/)
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 3);
}

function getSpeechRecognition() {
  return window.SpeechRecognition || window.webkitSpeechRecognition;
}

export default function App() {
  const [symptoms, setSymptoms] = useState("");
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const recognitionRef = useRef(null);
  const recordingBaseRef = useRef("");

  const speechSupported = useMemo(() => {
    if (typeof window === "undefined") return false;
    return Boolean(getSpeechRecognition());
  }, []);

  async function handleSubmit(event) {
    event.preventDefault();
    const trimmedSymptoms = symptoms.trim();

    if (!trimmedSymptoms) {
      setError("Tell MediVoice what you are feeling first.");
      return;
    }

    const apiKey = import.meta.env.VITE_GEMINI_API_KEY;
    const model = import.meta.env.VITE_GEMINI_MODEL || "gemini-2.5-flash";
    if (!apiKey) {
      setError("Missing API key. Add VITE_GEMINI_API_KEY to your .env file and restart the dev server.");
      return;
    }

    setIsLoading(true);
    setError("");
    setResult(null);

    try {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            systemInstruction: {
              parts: [{ text: SYSTEM_PROMPT }],
            },
            contents: [
              {
                role: "user",
                parts: [{ text: trimmedSymptoms }],
              },
            ],
            generationConfig: {
              temperature: 0.2,
              maxOutputTokens: 600,
              responseMimeType: "application/json",
            },
          }),
        }
      );

      if (!response.ok) {
        throw new Error(`Gemini request failed with status ${response.status}`);
      }

      const data = await response.json();
      const text = data?.candidates?.[0]?.content?.parts
        ?.map((part) => part.text || "")
        .join("")
        .trim();

      try {
        const parsed = JSON.parse(text);
        if (!URGENCY_STYLES[parsed.urgency]) {
          throw new Error("Unexpected urgency value");
        }
        setResult(parsed);
      } catch {
        setError(fallbackError);
      }
    } catch {
      setError("MediVoice could not reach Gemini right now. Check your API key, connection, and try again.");
    } finally {
      setIsLoading(false);
    }
  }

  function handleMicrophone() {
    if (!speechSupported) {
      setError("Voice input is not supported in this browser. You can still type your symptoms.");
      return;
    }

    if (isRecording && recognitionRef.current) {
      recognitionRef.current.stop();
      return;
    }

    const SpeechRecognition = getSpeechRecognition();
    const recognition = new SpeechRecognition();
    recognition.lang = "en-US";
    recognition.interimResults = true;
    recognition.continuous = false;
    recognitionRef.current = recognition;
    recordingBaseRef.current = symptoms.trim();

    let finalTranscript = "";
    recognition.onstart = () => {
      setError("");
      setIsRecording(true);
    };
    recognition.onresult = (event) => {
      let interimTranscript = "";
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const transcript = event.results[index][0].transcript;
        if (event.results[index].isFinal) {
          finalTranscript += transcript;
        } else {
          interimTranscript += transcript;
        }
      }
      const spokenText = `${finalTranscript} ${interimTranscript}`.trim();
      if (spokenText) {
        const base = recordingBaseRef.current;
        setSymptoms(`${base}${base ? " " : ""}${spokenText}`.trim());
      }
    };
    recognition.onerror = () => {
      setError("Voice input stopped unexpectedly. Please try the microphone again or type your symptoms.");
    };
    recognition.onend = () => {
      setIsRecording(false);
      recognitionRef.current = null;
      recordingBaseRef.current = "";
    };
    recognition.start();
  }

  function startOver() {
    if (recognitionRef.current) {
      recognitionRef.current.stop();
    }
    setSymptoms("");
    setResult(null);
    setError("");
    setIsLoading(false);
    setIsRecording(false);
  }

  const urgency = result ? URGENCY_STYLES[result.urgency] : null;

  return (
    <main className="min-h-screen px-4 py-6 sm:px-6 lg:px-8">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
        <header className="space-y-3 pt-4">
          <p className="text-sm font-semibold uppercase tracking-[0.18em] text-teal-700">MediVoice</p>
          <div className="space-y-3">
            <h1 className="text-3xl font-bold leading-tight text-slate-950 sm:text-5xl">
              Describe what feels wrong.
            </h1>
            <p className="max-w-2xl text-base leading-7 text-slate-600 sm:text-lg">
              Get calm, plain-English triage guidance you can act on right now.
            </p>
          </div>
        </header>

        <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
          <form className="space-y-4" onSubmit={handleSubmit}>
            <label htmlFor="symptoms" className="block text-sm font-semibold text-slate-800">
              Symptoms
            </label>
            <textarea
              id="symptoms"
              value={symptoms}
              onChange={(event) => setSymptoms(event.target.value)}
              placeholder="Example: I woke up with tightness in my chest and feel short of breath..."
              className="min-h-44 w-full resize-y rounded-lg border border-slate-300 bg-white px-4 py-3 text-base leading-7 text-slate-950 outline-none transition focus:border-teal-600 focus:ring-4 focus:ring-teal-100"
            />

            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <button
                type="button"
                onClick={handleMicrophone}
                className="inline-flex min-h-12 items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-800 transition hover:bg-slate-50 focus:outline-none focus:ring-4 focus:ring-teal-100"
                aria-pressed={isRecording}
              >
                <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <path
                    d="M12 14a3 3 0 0 0 3-3V6a3 3 0 1 0-6 0v5a3 3 0 0 0 3 3Z"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                  />
                  <path
                    d="M19 11a7 7 0 0 1-14 0M12 18v3M9 21h6"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                  />
                </svg>
                {isRecording ? "Stop Recording" : "Use Voice"}
                {isRecording && (
                  <span className="h-3 w-3 rounded-full bg-red-600 motion-safe:animate-ping" aria-label="Recording" />
                )}
              </button>
              <button
                type="submit"
                disabled={isLoading}
                className="inline-flex min-h-12 flex-1 items-center justify-center rounded-lg bg-teal-700 px-5 text-sm font-bold text-white transition hover:bg-teal-800 focus:outline-none focus:ring-4 focus:ring-teal-200 disabled:cursor-not-allowed disabled:bg-slate-400"
              >
                {isLoading ? "Checking Symptoms..." : "Check Urgency"}
              </button>
            </div>
          </form>
        </section>

        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm leading-6 text-red-900" role="alert">
            {error}
          </div>
        )}

        {isLoading && <LoadingSkeleton />}

        {result && urgency && (
          <section className="space-y-4">
            <div className={`rounded-lg border p-5 ${urgency.panel}`}>
              <p className="mb-3 text-sm font-semibold uppercase tracking-[0.14em] text-slate-700">Urgency</p>
              <div className={`inline-flex w-full items-center justify-center rounded-lg px-5 py-4 text-center text-2xl font-black ring-2 sm:text-4xl ${urgency.badge}`}>
                {urgency.label}
              </div>
              <p className="mt-4 text-base leading-7 text-slate-800">{result.urgency_reason}</p>
            </div>

            <ResultSection title="What This Could Be" body={result.possible_causes} />
            <ResultSection title="Most Helpful Thing Right Now" body={result.action_now} />

            <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
              <h2 className="text-lg font-bold text-slate-950">What to Bring to a Doctor</h2>
              <ul className="mt-3 space-y-2 text-base leading-7 text-slate-700">
                {normalizeBullets(result.bring_to_doctor).map((item) => (
                  <li key={item} className="flex gap-2">
                    <span className={`mt-2 h-2 w-2 flex-none rounded-full ${urgency.dot}`} />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>

            <button
              type="button"
              onClick={startOver}
              className="min-h-12 w-full rounded-lg border border-slate-300 bg-white px-5 text-sm font-bold text-slate-800 transition hover:bg-slate-50 focus:outline-none focus:ring-4 focus:ring-teal-100"
            >
              Start Over
            </button>
          </section>
        )}

        <footer className="pb-6 pt-2 text-center text-sm leading-6 text-slate-500">
          This tool does not replace professional medical advice.
        </footer>
      </div>
    </main>
  );
}

function ResultSection({ title, body }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
      <h2 className="text-lg font-bold text-slate-950">{title}</h2>
      <p className="mt-3 text-base leading-7 text-slate-700">{body}</p>
    </div>
  );
}

function LoadingSkeleton() {
  return (
    <section className="space-y-4" aria-label="Loading triage guidance">
      {[0, 1, 2].map((item) => (
        <div key={item} className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
          <div className="h-5 w-2/5 rounded bg-slate-200 motion-safe:animate-pulse" />
          <div className="mt-4 h-4 w-full rounded bg-slate-200 motion-safe:animate-pulse" />
          <div className="mt-3 h-4 w-4/5 rounded bg-slate-200 motion-safe:animate-pulse" />
        </div>
      ))}
    </section>
  );
}
