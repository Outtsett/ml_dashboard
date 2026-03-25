import { db } from "../src/server/database/db";
import { mlModels } from "../src/shared/schema";

const ARCHITECTURES = [
  "TCN-Transformer", "Sticky-HDP-HMM", "Dilated-TCN", "Quantum-Variational", 
  "Hilbert-Space-Classifier", "PPO-Executor", "Risk-Sanctuary-XAI", "LSTM-Gated-Memory",
  "Autoencoder-Manifold", "Contrastive-Temporal-Net"
];

const CATEGORIES = ["Quant", "Quantum", "Strategic", "Structural", "Temporal"];

async function main() {
  console.log("Seeding 300 models into the Model Catalog...");
  
  const models = [];
  for (let i = 1; i <= 300; i++) {
    const arch = ARCHITECTURES[i % ARCHITECTURES.length];
    const cat = CATEGORIES[i % CATEGORIES.length];
    models.push({
      name: `Specialized Expert #${i.toString().padStart(3, "0")}`,
      version: "1.0.0",
      architecture: arch,
      category: cat,
      subcategory: "Institutional",
      description: `Specialized ${arch} model trained for regime-specific alpha capture. Model #${i}.`,
      status: "active",
      hyperparameters: JSON.stringify({ layer_count: 4, dropout: 0.2, learning_rate: 0.001 }),
      metrics: JSON.stringify({ sharpe: (Math.random() * 2 + 1).toFixed(2), win_rate: (Math.random() * 20 + 50).toFixed(1) + "%" }),
    });
  }

  await db.insert(mlModels).values(models);
  console.log("✓ Successfully seeded 300 models.");
}

main().catch(console.error);