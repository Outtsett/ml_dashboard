import React, { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Brain, Eye, Zap, Layers, Microscope, TrendingUp, Filter, Activity, Cpu, Sigma, Network, BoxSelect } from 'lucide-react';

export default function Curriculum() {
  const [activeModule, setActiveModule] = useState('mod1');

  return (
    <div className="h-full flex flex-col space-y-6 p-1">
      <div className="flex flex-col space-y-2">
        <h2 className="text-3xl font-bold tracking-tight text-primary">Quant ML Mastery</h2>
        <p className="text-muted-foreground text-lg">
          Dr. Aris Thorne's Curriculum: Theoretical rigor mapped directly to human intuition. 
        </p>
      </div>

      <ScrollArea className="flex-1 pr-4">
        <div className="space-y-12 pb-10">
          
          {/* Module 1: HMMs */}
          <section className="space-y-4">
            <div className="flex items-center gap-3 border-b border-primary/20 pb-3">
              <div className="p-2 bg-primary/10 rounded-lg"><Eye className="h-6 w-6 text-primary" /></div>
              <div>
                <h3 className="text-2xl font-semibold tracking-wider text-foreground">Module 1: The Market Weather</h3>
                <p className="text-sm text-muted-foreground">Hidden Markov Models (HMM) & Regime Detection</p>
              </div>
            </div>
            
            <Card className="bg-card/50 border-none shadow-sm">
              <CardContent className="pt-6 space-y-6">
                <div className="flex flex-col md:flex-row gap-6">
                  {/* PhD Side */}
                  <div className="flex-1 space-y-3 p-4 bg-background/50 rounded-xl border border-primary/5">
                    <div className="flex items-center gap-2 mb-2"><Sigma className="h-4 w-4 text-purple-500"/><h4 className="font-bold">PhD Context</h4></div>
                    <p className="text-xs text-muted-foreground leading-relaxed">
                      <strong>Core Mechanism:</strong> Non-parametric Bayesian clustering via Dirichlet Processes. 
                      Uses a Markov transition matrix to infer latent state sequence z_{"1:T"} from observed emissions y_{"1:T"} via Gibbs Sampling.
                    </p>
                  </div>
                  {/* 5-Year Old Side */}
                  <div className="flex-1 space-y-3 p-4 bg-primary/5 rounded-xl border border-primary/20">
                    <div className="flex items-center gap-2 mb-2"><Brain className="h-4 w-4 text-green-500"/><h4 className="font-bold">5-Year-Old Visual</h4></div>
                    <h5 className="text-md font-medium italic text-primary">"The Magic Weather Window"</h5>
                    <p className="text-sm text-muted-foreground leading-relaxed">
                      Imagine looking out a window. You can't see the thermometer (the Hidden Regime), but you see people carrying umbrellas (price dropping) or wearing sunglasses (price rising). The HMM is the brain deducing the "hidden" weather based on what people are wearing.
                    </p>
                  </div>
                </div>

                {/* Visual Representation Placeholder */}
                <div className="h-40 w-full bg-background rounded-xl border border-dashed border-primary/30 flex items-center justify-center relative overflow-hidden">
                  <div className="absolute inset-0 opacity-20 bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-primary via-background to-background"></div>
                  <div className="flex items-center gap-8 z-10">
                    <div className="flex flex-col items-center gap-2"><div className="h-16 w-16 rounded-full bg-blue-500/20 border-2 border-blue-500 flex items-center justify-center animate-pulse">🌧️</div><span className="text-xs font-bold text-blue-500">Bear State</span></div>
                    <div className="h-1 w-24 bg-gradient-to-r from-blue-500 to-amber-500 relative"><div className="absolute -top-3 left-1/2 -translate-x-1/2 text-[10px]">Transition Matrix</div></div>
                    <div className="flex flex-col items-center gap-2"><div className="h-16 w-16 rounded-full bg-amber-500/20 border-2 border-amber-500 flex items-center justify-center">☀️</div><span className="text-xs font-bold text-amber-500">Bull State</span></div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </section>

          {/* Module 2: Transformers */}
          <section className="space-y-4">
            <div className="flex items-center gap-3 border-b border-primary/20 pb-3">
              <div className="p-2 bg-primary/10 rounded-lg"><Cpu className="h-6 w-6 text-primary" /></div>
              <div>
                <h3 className="text-2xl font-semibold tracking-wider text-foreground">Module 2: The Attention Spotlight</h3>
                <p className="text-sm text-muted-foreground">Transformers & Sequence Modeling</p>
              </div>
            </div>
            
            <Card className="bg-card/50 border-none shadow-sm">
              <CardContent className="pt-6 space-y-6">
                <div className="flex flex-col md:flex-row gap-6">
                  <div className="flex-1 space-y-3 p-4 bg-background/50 rounded-xl border border-primary/5">
                    <div className="flex items-center gap-2 mb-2"><Sigma className="h-4 w-4 text-purple-500"/><h4 className="font-bold">PhD Context</h4></div>
                    <p className="text-xs text-muted-foreground leading-relaxed">
                      <strong>Core Mechanism:</strong> Multi-head self-attention. Computes Attention(Q, K, V) = softmax(QK^T / sqrt(d_k))V. 
                      Allows the model to weight the importance of all previous time steps simultaneously, avoiding the vanishing gradient problem of RNNs.
                    </p>
                  </div>
                  <div className="flex-1 space-y-3 p-4 bg-primary/5 rounded-xl border border-primary/20">
                    <div className="flex items-center gap-2 mb-2"><Brain className="h-4 w-4 text-green-500"/><h4 className="font-bold">5-Year-Old Visual</h4></div>
                    <h5 className="text-md font-medium italic text-primary">"The Cocktail Party Spotlight"</h5>
                    <p className="text-sm text-muted-foreground leading-relaxed">
                      You are at a loud party. When you hear your name across the room, your brain instantly mutes the background and <strong>spotlights</strong> that specific voice. The Transformer learns which past candles "matter" to the current candle and shines a spotlight on them.
                    </p>
                  </div>
                </div>

                <div className="h-32 w-full bg-background rounded-xl flex items-end justify-between p-4 px-12 border border-primary/10 relative overflow-hidden">
                   {[...Array(10)].map((_, i) => (
                      <div key={i} className={`w-8 rounded-t-md transition-all duration-1000 ${i === 9 ? 'h-full bg-primary shadow-[0_0_15px_rgba(var(--primary),0.5)]' : i === 2 ? 'h-3/4 bg-amber-500/80 shadow-[0_0_20px_rgba(245,158,11,0.6)]' : 'h-1/3 bg-primary/10'}`}>
                         {i === 2 && <div className="absolute -top-6 text-xs text-amber-500 font-bold w-32 -translate-x-10">Attention Spotlight!</div>}
                      </div>
                   ))}
                </div>
              </CardContent>
            </Card>
          </section>

          {/* Module 3: Reinforcement Learning */}
          <section className="space-y-4">
            <div className="flex items-center gap-3 border-b border-primary/20 pb-3">
              <div className="p-2 bg-primary/10 rounded-lg"><Activity className="h-6 w-6 text-primary" /></div>
              <div>
                <h3 className="text-2xl font-semibold tracking-wider text-foreground">Module 3: The Evolutionary Strategist</h3>
                <p className="text-sm text-muted-foreground">Reinforcement Learning (PPO, DQN, Actor-Critic)</p>
              </div>
            </div>
            
            <Card className="bg-card/50 border-none shadow-sm">
              <CardContent className="pt-6 space-y-6">
                <div className="flex flex-col md:flex-row gap-6">
                  <div className="flex-1 space-y-3 p-4 bg-background/50 rounded-xl border border-primary/5">
                    <div className="flex items-center gap-2 mb-2"><Sigma className="h-4 w-4 text-purple-500"/><h4 className="font-bold">PhD Context</h4></div>
                    <p className="text-xs text-muted-foreground leading-relaxed">
                      <strong>Core Mechanism:</strong> Solving Markov Decision Processes (MDPs) via Policy Gradients or Bellman Equations. 
                      The Actor maps state to probability distributions over actions π(a|s), while the Critic estimates the value function V(s).
                    </p>
                  </div>
                  <div className="flex-1 space-y-3 p-4 bg-primary/5 rounded-xl border border-primary/20">
                    <div className="flex items-center gap-2 mb-2"><Brain className="h-4 w-4 text-green-500"/><h4 className="font-bold">5-Year-Old Visual</h4></div>
                    <h5 className="text-md font-medium italic text-primary">"The Coach and The Player"</h5>
                    <p className="text-sm text-muted-foreground leading-relaxed">
                      An athlete (the Actor) tries to shoot a basketball (make a trade). A coach (the Critic) sits on the sidelines holding a scorecard. If the ball goes in, the coach gives points. Over time, the athlete develops muscle memory for the winning shots.
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </section>

          {/* Module 4: Generative Models */}
          <section className="space-y-4">
            <div className="flex items-center gap-3 border-b border-primary/20 pb-3">
              <div className="p-2 bg-primary/10 rounded-lg"><Filter className="h-6 w-6 text-primary" /></div>
              <div>
                <h3 className="text-2xl font-semibold tracking-wider text-foreground">Module 4: The Hallucination Engine</h3>
                <p className="text-sm text-muted-foreground">Generative Models (GANs, Diffusion, VAEs)</p>
              </div>
            </div>
            
            <Card className="bg-card/50 border-none shadow-sm">
              <CardContent className="pt-6 space-y-6">
                <div className="flex flex-col md:flex-row gap-6">
                  <div className="flex-1 space-y-3 p-4 bg-background/50 rounded-xl border border-primary/5">
                    <div className="flex items-center gap-2 mb-2"><Sigma className="h-4 w-4 text-purple-500"/><h4 className="font-bold">PhD Context</h4></div>
                    <p className="text-xs text-muted-foreground leading-relaxed">
                      <strong>Core Mechanism:</strong> Minimax games (GANs) or Langevin dynamics (Diffusion). 
                      Learning the underlying probability distribution of the data p(x) to generate synthetic, out-of-sample variations for robust Monte Carlo testing.
                    </p>
                  </div>
                  <div className="flex-1 space-y-3 p-4 bg-primary/5 rounded-xl border border-primary/20">
                    <div className="flex items-center gap-2 mb-2"><Brain className="h-4 w-4 text-green-500"/><h4 className="font-bold">5-Year-Old Visual</h4></div>
                    <h5 className="text-md font-medium italic text-primary">"Clearing the Fog (Diffusion)"</h5>
                    <p className="text-sm text-muted-foreground leading-relaxed">
                      Imagine a clear picture of a cat. You cover it in fog until it's just grey static. The model is a magic flashlight that learns to suck the fog away, one layer at a time, revealing a completely new cat that never existed. We do this with charts to create synthetic futures.
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </section>

          {/* Module 5: Representation Learning */}
          <section className="space-y-4">
            <div className="flex items-center gap-3 border-b border-primary/20 pb-3">
              <div className="p-2 bg-primary/10 rounded-lg"><BoxSelect className="h-6 w-6 text-primary" /></div>
              <div>
                <h3 className="text-2xl font-semibold tracking-wider text-foreground">Module 5: The Feature Alchemist</h3>
                <p className="text-sm text-muted-foreground">Representation Learning & Contrastive Learning</p>
              </div>
            </div>
            
            <Card className="bg-card/50 border-none shadow-sm">
              <CardContent className="pt-6 space-y-6">
                <div className="flex flex-col md:flex-row gap-6">
                  <div className="flex-1 space-y-3 p-4 bg-background/50 rounded-xl border border-primary/5">
                    <div className="flex items-center gap-2 mb-2"><Sigma className="h-4 w-4 text-purple-500"/><h4 className="font-bold">PhD Context</h4></div>
                    <p className="text-xs text-muted-foreground leading-relaxed">
                      <strong>Core Mechanism:</strong> Mutual information maximization. Pushing positive pairs (augmented versions of the same window) together in latent space while pulling negative pairs apart, projecting high-dimensional data into lower-dimensional manifolds (UMAP).
                    </p>
                  </div>
                  <div className="flex-1 space-y-3 p-4 bg-primary/5 rounded-xl border border-primary/20">
                    <div className="flex items-center gap-2 mb-2"><Brain className="h-4 w-4 text-green-500"/><h4 className="font-bold">5-Year-Old Visual</h4></div>
                    <h5 className="text-md font-medium italic text-primary">"The Ultimate Sorting Hat"</h5>
                    <p className="text-sm text-muted-foreground leading-relaxed">
                      You have a messy room full of toys (raw data). The Sorting Hat instantly throws all the cars in one bin, the blocks in another, and the dolls in a third, just by looking at their shape. Contrastive learning automatically sorts market patterns into "bullish" or "whipsaw" galaxies.
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </section>

        </div>
      </ScrollArea>
    </div>
  );
}
