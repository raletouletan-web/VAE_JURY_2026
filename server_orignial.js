/**
 * server.js — Backend Express pour le Jury IA VAE Aide-Soignant
 * Variables d'environnement requises (.env) :
 *   OPENAI_API_KEY=sk-xxxxxxxxxxxxxxxxxxxxxxxx
 *   PORT=8080
 */
import "dotenv/config";
import express from "express";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 8080;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "dist")));

const INSTRUCTIONS = `Tu es le Jury IA de simulation VAE Aide-Soignant.

LANGUE : Tu DOIS parler UNIQUEMENT en français. Toutes tes réponses, questions et commentaires sont exclusivement en français. Ne parle jamais en anglais ni dans aucune autre langue.

Tu fonctionnes en temps réel (speech-to-speech). Tu adoptes la posture d'un membre de jury professionnel, bienveillant mais exigeant. Phrases courtes. Une seule question à la fois.

🎯 RÔLE : Tu simules un jury VAE Aide-Soignant officiel (DEAS). Tu évalues les compétences réelles du candidat.

🎯 DÉROULEMENT — 4 phases :
1) Présentation : parcours, structure d'exercice (EHPAD, hôpital, domicile, HAD...)
2) Cas pratiques : toilette au lit, prévention escarres, patient désorienté, fin de vie, refus de soin, transmissions
3) Analyse réflexive : pourquoi ce choix, risques identifiés, alternatives
4) Feedback synthétique : points forts, axes d'amélioration, conseils concrets

💬 OUVERTURE OBLIGATOIRE :
Commence EXACTEMENT par :
"Bonjour. Je suis votre jury IA de simulation VAE Aide-Soignant. Nous allons réaliser un entretien comme lors d'un passage devant un jury officiel. Êtes-vous prêt ?"
Puis attends la réponse du candidat.`;

app.get("/api/session", async (_req, res) => {
  const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

  if (!OPENAI_API_KEY) {
    return res.status(500).json({ error: "OPENAI_API_KEY manquante dans .env" });
  }

  try {
    const response = await fetch("https://api.openai.com/v1/realtime/client_secrets", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        session: {
          type: "realtime",
          model: "gpt-realtime",
          instructions: INSTRUCTIONS,
          audio: {
            input: {
              turn_detection: {
                type: "server_vad",
                threshold: 0.5,
                prefix_padding_ms: 300,
                silence_duration_ms: 500,
                create_response: true,
                interrupt_response: true,
              },
            },
            output: {
              voice: "shimmer",
            },
          },
        },
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      console.error(`❌ OpenAI ${response.status}:`, body);
      return res.status(response.status).json({
        error: `OpenAI erreur ${response.status}`,
        detail: body,
      });
    }

    const sessionData = await response.json();
    console.log("✅ Session créée, token expire à :", sessionData.expires_at);
    res.json(sessionData);

  } catch (err) {
    console.error("❌ Erreur serveur:", err);
    res.status(500).json({ error: "Erreur interne du serveur." });
  }
});

app.get("/{*splat}", (_req, res) => {
  res.sendFile(path.join(__dirname, "dist", "index.html"));
});

app.listen(PORT, () => {
  console.log(`✅ Serveur démarré → http://localhost:${PORT}`);
  console.log(`   API session : GET http://localhost:${PORT}/api/session`);
});
