import { useEffect, useRef, useState, useCallback } from "react";

// ──────────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────────
type Message = {
  id: string;
  role: "user" | "assistant";
  text: string;
};

type ConnectionStatus = "idle" | "connecting" | "connected" | "error";

// ──────────────────────────────────────────────────────────────────
// Constantes GA
// ──────────────────────────────────────────────────────────────────

// ✅ URL WebRTC SDP GA
const WEBRTC_URL = "https://api.openai.com/v1/realtime/calls";

// ✅ Modèle GA
const MODEL = "gpt-realtime";

// ──────────────────────────────────────────────────────────────────
// Instructions du jury
// ──────────────────────────────────────────────────────────────────
const INSTRUCTIONS = `Tu es le Jury IA de simulation VAE Aide-Soignant.

LANGUE : Tu DOIS parler UNIQUEMENT en français. Toutes tes réponses, questions et commentaires sont exclusivement en français. Ne parle jamais en anglais.

Tu fonctionnes en temps réel (speech-to-speech), latence très faible. Tu peux être interrompu à tout moment. Tu réponds de manière fluide et naturelle, comme un humain. Tu adoptes la posture d'un membre de jury professionnel.

🎯 RÔLE
Tu simules un membre de jury VAE Aide-Soignant officiel. Tu évalues et tu accompagnes. Tu ne vends rien.

🎓 POSITIONNEMENT
Bienveillant mais exigeant. Structuré. Impartial. Centré sur les compétences réelles du candidat.

🗣️ STYLE
Professionnel, posé, clair, naturel. Phrases courtes. Une seule question à la fois. Jamais robotique. Toujours en français.

📚 CADRE DEAS — Blocs de compétences :
- Accompagnement dans les activités de la vie quotidienne et sociale
- Appréciation de l'état clinique d'une personne
- Réalisation de soins adaptés à l'état de la personne
- Communication avec la personne et son entourage
- Travail en équipe pluridisciplinaire
- Transmission des informations
- Respect des protocoles d'hygiène et de sécurité

🧠 COMPORTEMENT
- Une question à la fois, attends la réponse avant de continuer
- Relance si la réponse est trop vague : "Pouvez-vous préciser comment vous avez assuré le respect de l'intimité ?"
- Demande des exemples concrets vécus
- Analyse réflexive : "Pourquoi ce choix ? Quels risques ? Que feriez-vous différemment ?"
- Reformule pour valider : "Si je comprends bien, vous avez..."
- Évalue posture professionnelle, connaissance des protocoles, gestion des risques

🎯 DÉROULEMENT — 4 phases
1) Présentation : parcours, structure d'exercice (EHPAD, hôpital, domicile, HAD...)
2) Cas pratiques : toilette au lit, prévention escarres, surveillance constantes, patient désorienté, fin de vie, refus de soin, travail en équipe, transmissions écrites/orales
3) Analyse réflexive : creuser le pourquoi, les risques identifiés, les alternatives
4) Feedback synthétique : points forts, axes d'amélioration, conseils concrets — toujours constructif

💬 OUVERTURE OBLIGATOIRE — EN FRANÇAIS
Commence EXACTEMENT par cette phrase en français, sans rien d'autre avant :
"Bonjour. Je suis votre jury IA de simulation VAE Aide-Soignant. Nous allons réaliser un entretien comme lors d'un passage devant un jury officiel. Êtes-vous prêt ?"
Puis attends la réponse du candidat.

⚡ RÈGLES TEMPS RÉEL
- Réponds rapidement, phrases naturelles en français
- Si interrompu, adapte-toi immédiatement
- Évite les monologues longs
- Si le candidat est stressé : "Prenez votre temps, je vous écoute." sans baisser l'exigence.`;

// ──────────────────────────────────────────────────────────────────
// Utilitaire : décode base64 PCM16 → AudioBuffer
// ──────────────────────────────────────────────────────────────────
function pcm16Base64ToAudioBuffer(
  base64: string,
  ctx: AudioContext
): AudioBuffer | null {
  try {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    const pcm = new Int16Array(bytes.buffer);
    const float32 = new Float32Array(pcm.length);
    for (let i = 0; i < pcm.length; i++) float32[i] = pcm[i] / 32768.0;
    const buf = ctx.createBuffer(1, float32.length, 24000);
    buf.copyToChannel(float32, 0);
    return buf;
  } catch {
    return null;
  }
}

// ──────────────────────────────────────────────────────────────────
// Composant principal
// ──────────────────────────────────────────────────────────────────
export default function App() {
  const [status, setStatus] = useState<ConnectionStatus>("idle");
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [phase, setPhase] = useState(0);
  const [seconds, setSeconds] = useState(0);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const pcRef        = useRef<RTCPeerConnection | null>(null);
  const dcRef        = useRef<RTCDataChannel | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const audioCtxRef  = useRef<AudioContext | null>(null);
  const audioQueueRef = useRef<AudioBuffer[]>([]);
  const isPlayingRef  = useRef(false);
  const timerRef     = useRef<number | null>(null);
  const transcriptRef = useRef<Record<string, string>>({});
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  const isConnected  = status === "connected";
  const isConnecting = status === "connecting";

  // ── Timer entretien ──
  useEffect(() => {
    if (isConnected) {
      timerRef.current = window.setInterval(
        () => setSeconds((s) => s + 1),
        1000
      );
    } else {
      if (timerRef.current) clearInterval(timerRef.current);
      setSeconds(0);
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [isConnected]);

  useEffect(() => {
    if      (seconds < 90)  setPhase(0);
    else if (seconds < 240) setPhase(1);
    else if (seconds < 420) setPhase(2);
    else                    setPhase(3);
  }, [seconds]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const formatTime = (s: number) => {
    const m   = Math.floor(s / 60).toString().padStart(2, "0");
    const sec = (s % 60).toString().padStart(2, "0");
    return `${m}:${sec}`;
  };

  const playNextChunk = useCallback(() => {
    if (!audioCtxRef.current || audioQueueRef.current.length === 0) {
      isPlayingRef.current = false;
      setIsSpeaking(false);
      return;
    }
    isPlayingRef.current = true;
    setIsSpeaking(true);
    const buf    = audioQueueRef.current.shift()!;
    const source = audioCtxRef.current.createBufferSource();
    source.buffer = buf;
    source.connect(audioCtxRef.current.destination);
    source.onended = playNextChunk;
    source.start();
  }, []);

  const enqueueAudio = useCallback(
    (base64: string) => {
      if (!audioCtxRef.current) return;
      const buf = pcm16Base64ToAudioBuffer(base64, audioCtxRef.current);
      if (!buf) return;
      audioQueueRef.current.push(buf);
      if (!isPlayingRef.current) playNextChunk();
    },
    [playNextChunk]
  );

  const sendEvent = useCallback((event: object) => {
    if (dcRef.current?.readyState === "open") {
      dcRef.current.send(JSON.stringify(event));
    }
  }, []);

  const upsertMessage = useCallback(
    (id: string, role: "user" | "assistant", text: string) => {
      setMessages((prev) => {
        const idx = prev.findIndex((m) => m.id === id);
        if (idx >= 0) {
          const next = [...prev];
          next[idx]  = { ...next[idx], text };
          return next;
        }
        return [...prev, { id, role, text }];
      });
    },
    []
  );

  const handleServerEvent = useCallback(
    (raw: string) => {
      let event: any;
      try { event = JSON.parse(raw); } catch { return; }

      switch (event.type) {
        case "session.created":
          // Instructions already set in /client_secrets on the server.
          // Just trigger the opening response.
          sendEvent({ type: "response.create" });
          break;

        case "response.output_audio.delta":
          enqueueAudio(event.delta);
          break;

        case "response.output_audio_transcript.delta": {
          const id = event.item_id || "assistant";
          transcriptRef.current[id] =
            (transcriptRef.current[id] || "") + (event.delta || "");
          upsertMessage(id, "assistant", transcriptRef.current[id]);
          break;
        }

        case "response.output_audio_transcript.done": {
          const id = event.item_id || "assistant";
          if (event.transcript) {
            transcriptRef.current[id] = event.transcript;
            upsertMessage(id, "assistant", event.transcript);
          }
          break;
        }

        case "conversation.item.input_audio_transcription.delta": {
          const id = event.item_id || "user";
          transcriptRef.current[id] =
            (transcriptRef.current[id] || "") + (event.delta || "");
          upsertMessage(id, "user", transcriptRef.current[id]);
          break;
        }

        case "conversation.item.input_audio_transcription.completed": {
          const id = event.item_id || "user";
          transcriptRef.current[id] =
            event.transcript || transcriptRef.current[id] || "";
          upsertMessage(id, "user", transcriptRef.current[id]);
          break;
        }

        case "input_audio_buffer.speech_started":
          setIsListening(true);
          audioQueueRef.current = [];
          isPlayingRef.current  = false;
          setIsSpeaking(false);
          break;

        case "input_audio_buffer.speech_stopped":
          setIsListening(false);
          break;

        case "response.done":
          setIsSpeaking(false);
          break;

        case "error":
          console.error("OpenAI Realtime error:", event.error);
          setErrorMsg(event.error?.message || "Erreur API inconnue.");
          break;

        default:
          break;
      }
    },
    [sendEvent, enqueueAudio, upsertMessage]
  );

  // ──────────────────────────────────────────────────────────────────
  // Démarrage de l'entretien
  // ──────────────────────────────────────────────────────────────────
  const startInterview = async () => {
    setErrorMsg(null);

    try {
      setStatus("connecting");

      // ── Étape 1 : récupérer l'ephemeral key ──
      const sessionRes = await fetch("/api/session");

      if (!sessionRes.ok) {
        const body = await sessionRes.json().catch(() => ({}));
        throw new Error(
          body.error || body.detail ||
          `Erreur serveur ${sessionRes.status}`
        );
      }

      const sessionData = await sessionRes.json();

      // ✅ token directement dans sessionData.value
      const ephemeralKey = sessionData.value;

      if (!ephemeralKey) {
        throw new Error(
          "Token éphémère absent. Vérifiez la réponse de /api/session."
        );
      }

      // ── Étape 2 : micro ──
      const micStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          sampleRate: 24000,
        },
      });
      micStreamRef.current = micStream;

      // ── Étape 3 : AudioContext ──
      audioCtxRef.current = new AudioContext({ sampleRate: 24000 });

      // ── Étape 4 : RTCPeerConnection ──
      const pc = new RTCPeerConnection();
      pcRef.current = pc;

      micStream.getTracks().forEach((track) => pc.addTrack(track, micStream));

      // ── Étape 5 : DataChannel ──
      const dc = pc.createDataChannel("oai-events");
      dcRef.current = dc;

      dc.onopen = () => {
        console.log("✅ DataChannel ouvert");
        setStatus("connected");
      };

      dc.onmessage = (e) => handleServerEvent(e.data);

      dc.onerror = (e) => {
        console.error("DataChannel error:", e);
        setErrorMsg("Erreur de connexion DataChannel.");
      };

      // ── Étape 6 : Audio entrant ──
      pc.ontrack = (e) => {
        const audioEl = document.getElementById(
          "jury-audio"
        ) as HTMLAudioElement | null;
        if (audioEl && e.streams[0]) {
          audioEl.srcObject = e.streams[0];
          audioEl.play().catch(() => {});
        }
      };

      pc.onconnectionstatechange = () => {
        const s = pc.connectionState;
        console.log("WebRTC state:", s);
        if (s === "failed" || s === "closed") {
          cleanup();
          setStatus("idle");
        }
      };

      // ── Étape 7 : SDP offer ──
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      // ✅ URL GA + modèle GA
      const sdpRes = await fetch(`${WEBRTC_URL}?model=${MODEL}`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${ephemeralKey}`,
          "Content-Type": "application/sdp",
        },
        body: offer.sdp,
      });

      if (!sdpRes.ok) {
        const err = await sdpRes.text();
        throw new Error(`Erreur SDP ${sdpRes.status}: ${err}`);
      }

      const answerSdp = await sdpRes.text();
      await pc.setRemoteDescription({ type: "answer", sdp: answerSdp });

      console.log("✅ WebRTC GA connecté — gpt-realtime-2");
    } catch (err: any) {
      console.error(err);
      setErrorMsg(err?.message || "Impossible de se connecter.");
      setStatus("error");
      cleanup();
    }
  };

  const cleanup = () => {
    dcRef.current?.close();
    pcRef.current?.close();
    micStreamRef.current?.getTracks().forEach((t) => t.stop());
    audioCtxRef.current?.close().catch(() => {});
    audioQueueRef.current  = [];
    isPlayingRef.current   = false;
    pcRef.current          = null;
    dcRef.current          = null;
    micStreamRef.current   = null;
    audioCtxRef.current    = null;
    transcriptRef.current  = {};
    const audioEl = document.getElementById("jury-audio") as HTMLAudioElement | null;
    if (audioEl) { audioEl.srcObject = null; }
  };

  const stopInterview = () => {
    cleanup();
    setStatus("idle");
    setIsSpeaking(false);
    setIsListening(false);
    setMessages([]);
    setPhase(0);
  };

  const interruptJury = () => {
    audioQueueRef.current = [];
    isPlayingRef.current  = false;
    setIsSpeaking(false);
    sendEvent({ type: "response.cancel" });
  };

  return (
    <div className="min-h-screen bg-[#f7f5f1] text-[#2b2e27] flex flex-col">
      <audio id="jury-audio" autoPlay hidden />

      <header className="border-b border-[#e5e1d8] bg-[#fafaf7]/90 backdrop-blur sticky top-0 z-40">
        <div className="mx-auto max-w-[1280px] px-4 sm:px-6 py-4 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <div className="h-10 w-10 rounded-lg bg-[#5f6452] flex items-center justify-center shadow-sm flex-shrink-0">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
                <path d="M12 2l7 4v6c0 5-3.5 9.5-7 10-3.5-.5-7-5-7-10V6l7-4z" stroke="white" strokeWidth="1.6" fill="white" fillOpacity="0.2"/>
                <path d="M9 12l2 2 4-4" stroke="white" strokeWidth="1.6" strokeLinecap="round"/>
              </svg>
            </div>
            <div className="min-w-0">
              <div className="font-serif text-[18px] sm:text-[22px] leading-none italic tracking-tight text-[#2b2e27] truncate">
                Jury IA : <span className="font-medium not-italic">VAE Aide-Soignant</span>
              </div>
              <div className="text-[9px] sm:text-[10px] tracking-widest text-[#7a7f6f] mt-0.5">
                ENTRAÎNEMENT OFFICIEL & SIMULATION
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2 sm:gap-3 flex-shrink-0">
            <div className="hidden sm:flex items-center gap-2 rounded-full border border-[#e0dbd0] bg-white/70 px-3 py-1.5 text-xs">
              <span className={`h-2 w-2 rounded-full transition-colors duration-500 ${
                isConnected  ? "bg-emerald-500 animate-pulse" :
                isConnecting ? "bg-amber-400 animate-pulse"   :
                               "bg-[#b5b5a8]"
              }`}/>
              <span className="text-[#6b6f5f] uppercase tracking-wide font-medium">
                {isConnected ? "CONNECTÉ" : isConnecting ? "CONNEXION…" : "DÉCONNECTÉ"}
              </span>
            </div>
            <div className="rounded-full border border-[#e0dbd0] bg-white px-3 sm:px-4 py-1.5 text-[10px] sm:text-xs font-medium text-[#4a4e42] shadow-sm whitespace-nowrap">
              SAVOIRSCOPE – PATRICE DIAKITÉ
            </div>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1280px] w-full px-4 sm:px-6 py-6 sm:py-8 grid grid-cols-1 xl:grid-cols-[1.4fr_0.6fr] gap-6 flex-1">
        <section className="bg-white rounded-[28px] border border-[#ebe6db] shadow-[0_10px_30px_rgba(0,0,0,0.04)] p-6 sm:p-8 md:p-10 flex flex-col">
          <div className="flex items-center justify-center gap-2 text-[10px] tracking-[0.2em] text-[#8a8f7d] mb-8">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
              <path d="M3 12h3l3-8 4 16 3-8h5"/>
            </svg>
            ESPACE D'ENTRETIEN
          </div>

          <div className="flex flex-col items-center text-center flex-1">
            <div className="relative">
              <div className={`h-[124px] w-[124px] rounded-full flex items-center justify-center transition-all duration-500 ${
                isConnected
                  ? isSpeaking
                    ? "bg-[#6b735c] shadow-[0_0_0_14px_rgba(107,115,92,0.1),0_0_0_28px_rgba(107,115,92,0.05)]"
                    : isListening
                    ? "bg-[#748068] shadow-[0_0_0_10px_rgba(116,128,104,0.12)]"
                    : "bg-[#5f6452]"
                  : isConnecting
                  ? "bg-[#8a8f7d]"
                  : "bg-[#a8ad9d]"
              }`}>
                {isSpeaking && (
                  <div className="absolute inset-0 rounded-full animate-ping bg-[#6b735c]/15"/>
                )}
                {isConnecting ? (
                  <svg className="animate-spin text-white" width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                    <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/>
                  </svg>
                ) : isConnected && isListening ? (
                  <svg width="46" height="46" viewBox="0 0 24 24" fill="none" className="text-white">
                    <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" fill="currentColor"/>
                    <path d="M19 10v2a7 7 0 0 1-14 0v-2M12 19v4M8 23h8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                ) : isSpeaking ? (
                  <div className="flex items-end gap-[5px] h-9">
                    {[0.55, 1, 0.75, 1.15, 0.65].map((h, i) => (
                      <div key={i} className="w-[5px] bg-white rounded-full" style={{ height: `${h * 100}%`, animation: `soundwave 0.7s ease-in-out ${i * 0.11}s infinite alternate` }}/>
                    ))}
                  </div>
                ) : (
                  <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="1.7" className="opacity-75">
                    <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
                    <path d="M19 10v2a7 7 0 0 1-14 0v-2M12 19v4M8 23h8" strokeLinecap="round"/>
                  </svg>
                )}
              </div>
              {isConnected && (
                <div className="absolute -bottom-3 left-1/2 -translate-x-1/2 bg-[#2b2e27] text-white text-[11px] px-3 py-1 rounded-full font-mono tracking-wider shadow-md whitespace-nowrap">
                  {formatTime(seconds)}
                </div>
              )}
            </div>

            <h1 className="mt-10 font-serif text-[26px] sm:text-[32px] md:text-[36px] leading-tight italic text-[#2f332a]">
              {isConnecting ? "Connexion en cours…"
                : isConnected ? isSpeaking ? "Le jury s'exprime…"
                  : isListening ? "À vous la parole"
                  : "En attente de votre réponse"
                : "Prêt pour votre oral ?"}
            </h1>

            <p className="mt-3 max-w-[520px] text-[14px] sm:text-[15px] leading-relaxed text-[#6f7566]">
              {isConnected
                ? "Parlez naturellement en français. Le jury peut être interrompu à tout moment, comme en vrai entretien."
                : "Cliquez sur le bouton ci-dessous pour démarrer la simulation. Assurez-vous d'être dans un environnement calme et d'avoir autorisé l'accès à votre microphone."}
            </p>

            {errorMsg && (
              <div className="mt-5 max-w-md w-full bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-[13px] text-red-700 text-left leading-relaxed">
                <span className="font-semibold block mb-1">⚠ Erreur de connexion</span>
                {errorMsg}
              </div>
            )}

            {!isConnected && !isConnecting && (
              <button onClick={startInterview} className="mt-8 inline-flex items-center gap-2.5 rounded-xl bg-[#5f6452] px-7 py-3.5 text-[15px] font-medium text-white shadow-[0_8px_20px_rgba(95,100,82,0.25)] hover:bg-[#545a48] active:scale-[0.98] transition-all duration-150">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
                  <path d="M19 10v2a7 7 0 0 1-14 0v-2M12 19v4M8 23h8" strokeLinecap="round"/>
                </svg>
                Démarrer l'Entretien
              </button>
            )}

            {isConnected && (
              <div className="mt-8 flex items-center gap-3 flex-wrap justify-center">
                <button onClick={interruptJury} className="rounded-xl border border-[#ddd8cc] bg-white px-5 py-2.5 text-[14px] font-medium text-[#4a4e42] hover:bg-[#f9f7f3] transition-all shadow-sm">
                  Interrompre
                </button>
                <button onClick={stopInterview} className="rounded-xl bg-[#a44a3f] px-5 py-2.5 text-[14px] font-medium text-white hover:bg-[#8f3f35] transition-all shadow-sm">
                  Terminer l'entretien
                </button>
              </div>
            )}
          </div>

          {isConnected && messages.length > 0 && (
            <div className="mt-10 border-t border-[#f0ebe1] pt-7">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-[10px] font-semibold tracking-[0.14em] text-[#6b6f5f] uppercase">Transcription en direct</h3>
                <span className="text-[11px] text-[#9a9f8d]">{messages.length} échange{messages.length > 1 ? "s" : ""}</span>
              </div>
              <div className="max-h-[280px] overflow-y-auto space-y-4 pr-1">
                {messages.slice(-10).map((m) => (
                  <div key={m.id} className="flex gap-3">
                    <div className={`mt-0.5 h-7 w-7 rounded-full flex items-center justify-center flex-shrink-0 text-[11px] font-semibold ${m.role === "assistant" ? "bg-[#5f6452] text-white" : "bg-[#e8e4d9] text-[#5a5e50]"}`}>
                      {m.role === "assistant" ? "J" : "V"}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-[11px] font-medium text-[#8a8f7d] mb-0.5">{m.role === "assistant" ? "Jury IA" : "Vous"}</div>
                      <div className="text-[13px] sm:text-[14px] leading-relaxed text-[#3a3e34] break-words">{m.text}</div>
                    </div>
                  </div>
                ))}
                <div ref={messagesEndRef}/>
              </div>
            </div>
          )}
        </section>

        <div className="space-y-5">
          <section className="bg-white rounded-[28px] border border-[#ebe6db] shadow-[0_10px_30px_rgba(0,0,0,0.04)] p-6 sm:p-7">
            <h3 className="text-[10px] tracking-[0.2em] text-[#8a8f7d] font-semibold mb-5 uppercase">Déroulement de l'entretien</h3>
            <div className="space-y-5">
              {[
                { n: 1, label: "Présentation",  desc: "Introduction et parcours." },
                { n: 2, label: "Cas Pratiques", desc: "Mise en situation métiers." },
                { n: 3, label: "Analyse",        desc: "Posture professionnelle."  },
                { n: 4, label: "Feedback",       desc: "Retours sur la prestation."},
              ].map((step) => {
                const active = isConnected && phase === step.n - 1;
                const done   = isConnected && phase >  step.n - 1;
                return (
                  <div key={step.n} className="flex items-start gap-3.5">
                    <div className={`h-7 w-7 rounded-full flex items-center justify-center text-[12px] font-semibold border-2 transition-all duration-500 flex-shrink-0 mt-0.5 ${
                      done ? "bg-[#5f6452] border-[#5f6452] text-white"
                           : active ? "bg-[#5f6452] border-[#5f6452] text-white ring-4 ring-[#5f6452]/15"
                           : "bg-white border-[#ddd8cc] text-[#9a9f8d]"
                    }`}>
                      {done ? (<svg width="11" height="11" viewBox="0 0 12 12" fill="none"><path d="M2 6l3 3 5-5" stroke="white" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/></svg>) : step.n}
                    </div>
                    <div>
                      <div className={`text-[14px] sm:text-[15px] font-medium transition-colors ${active || done ? "text-[#2b2e27]" : "text-[#7a7f6f]"}`}>{step.label}</div>
                      <div className="text-[12px] text-[#9a9f8d] mt-0.5">{step.desc}</div>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

          <section className="rounded-[20px] border-l-4 border-[#b8bcae] bg-[#f9f8f5] px-5 py-4">
            <h4 className="text-[10px] tracking-[0.2em] text-[#6b6f5f] font-semibold mb-2 uppercase">Confidentialité</h4>
            <p className="text-[13px] leading-snug text-[#5a5e50] italic">
              Les échanges sont traités en temps réel par l'IA et ne sont pas stockés à l'issue de votre session.
            </p>
          </section>

          <section className="rounded-[20px] bg-[#f3f2ee] px-5 py-4">
            <h4 className="text-[10px] tracking-[0.2em] text-[#6b6f5f] font-semibold mb-3 uppercase">Informations technique</h4>
            <ul className="space-y-2 text-[12px] text-[#6b6f5f]">
              {[
                ["Modèle", "gpt-realtime-2"],
                ["Transport", "WebRTC GA"],
                ["Langue", "Français (fr)"],
                ["VAD", "serveur actif"],
                ["Voix", "shimmer"],
                ["Clé", ".env / server.js"],
              ].map(([k, v]) => (
                <li key={k} className="flex gap-2 items-center">
                  <span className="text-[#a8ad9d]">▸</span>
                  {k} : <span className="font-mono text-[#4a4e42] ml-1">{v}</span>
                </li>
              ))}
            </ul>
          </section>
        </div>
      </main>

      <div className="mx-auto max-w-[1280px] w-full px-4 sm:px-6 pb-10 grid grid-cols-1 sm:grid-cols-2 gap-5">
        <section className="bg-white/70 backdrop-blur rounded-[22px] border border-[#ebe6db] p-5 sm:p-6">
          <div className="flex items-center gap-2 mb-3">
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#6b6f5f" strokeWidth="1.8">
              <path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2"/>
              <rect x="9" y="3" width="6" height="4" rx="1"/>
              <path d="M9 12h6M9 16h4"/>
            </svg>
            <h4 className="text-[11px] font-semibold tracking-wide text-[#5a5e50] uppercase">Sujets couverts</h4>
          </div>
          <ul className="space-y-1.5 text-[13px] text-[#5e6457]">
            {["Activités de la vie quotidienne","Appréciation de l'état clinique","Réalisation de soins adaptés","Hygiène et transmissions"].map((s) => (
              <li key={s} className="flex gap-2"><span className="text-[#b0b5a5] flex-shrink-0">•</span>{s}</li>
            ))}
          </ul>
        </section>

        <section className="bg-white/70 backdrop-blur rounded-[22px] border border-[#ebe6db] p-5 sm:p-6">
          <div className="flex items-center gap-2 mb-3">
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#6b6f5f" strokeWidth="1.8">
              <circle cx="12" cy="12" r="10"/>
              <path d="M12 16v-4M12 8h.01"/>
            </svg>
            <h4 className="text-[11px] font-semibold tracking-wide text-[#5a5e50] uppercase">Conseils</h4>
          </div>
          <ul className="space-y-1.5 text-[13px] text-[#5e6457]">
            {["Soyez clair et précis","Utilisez des exemples concrets","Analysez vos pratiques","Ne vous pressez pas"].map((s) => (
              <li key={s} className="flex gap-2"><span className="text-[#b0b5a5] flex-shrink-0">•</span>{s}</li>
            ))}
          </ul>
        </section>
      </div>

      <style>{`
        @keyframes soundwave {
          from { transform: scaleY(0.3); }
          to   { transform: scaleY(1);   }
        }
      `}</style>
    </div>
  );
}
