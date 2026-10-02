"""Probabilistic Logic Network: truth values (strength, count) and the PLN inference rules.

Every term carries a truth value: a strength s (a probability) and an evidence
count n, whose confidence is c = n / (n + k) with k = ``evidence_scale``.
On the training span:

- **atoms** A are the grounded predicates; the implication link A -> Up has
  s = the smoothed training up-rate when A holds and n = how often A held;
- **concepts** B are the mined and authored conjunctions (``mine_rules``),
  with s_B = P(B), the link B -> Up and the links A -> B = P(B | A);
- a longer chain A -> B -> Up is the **deduction rule** (independence-based)
  s_AC = s_AB s_BC + (1 - s_AB)(s_C - s_B s_BC) / (1 - s_B), counted by how often
  A and B held together; ``maximum_chain_depth`` 3 also chains through a
  second concept (A -> B -> B' -> Up, two deductions).

For a bar, every derivation of Up from its true atoms (direct links up to the
chain depth) is merged by the **revision rule**: counts add, the strength is
the count-weighted mean. P(up) = c s + (1 - c) P(up) (low confidence shrinks
toward the base rate), and the score is its log-odds. Because each atom's
derivations are fixed after training, a bar's revision is a sum over its true
atoms of per-atom evidence (strength x count, count).
"""

from __future__ import annotations

import numpy as np

from cycle.adapters_extra.symbolic_reasoner.predicates import mine_rules
from cycle.adapters_extra.symbolic_reasoner.reasoning import Engine, logit, to_list


def deduction(s_ab, s_bc, s_b, s_c) -> np.ndarray:
    """PLN's independence-based deduction strength of A -> C through B."""
    s_ab, s_bc, s_b = (np.asarray(value, dtype=np.float64) for value in (s_ab, s_bc, s_b))
    rest = (s_c - s_b * s_bc) / np.maximum(1.0 - s_b, 1e-9)
    return np.clip(s_ab * s_bc + (1.0 - s_ab) * rest, 0.0, 1.0)


class ProbabilisticLogicNetwork(Engine):
    def fit(self, context, train_rows, target, direction):
        p = self.parameters
        truth = context.truth(train_rows)
        y = direction[train_rows]
        known = np.isfinite(y)
        concepts, base = mine_rules(context.bank, truth, y, atom_order=int(p["atom_order"]),
                                    minimum_fire_count=int(p["minimum_fire_count"]), rule_count=int(p["rule_count"]),
                                    pseudo_count=float(p["smoothing_pseudo_count"]))
        truth, y = truth[known], y[known]
        atoms = (truth == 1.0).astype(np.float64)                          # (n, A)
        pseudo = float(p["smoothing_pseudo_count"])
        count_a = atoms.sum(axis=0)
        strength_a = (atoms.T @ y + pseudo * base) / (count_a + pseudo)    # A -> Up
        concept_hits = np.column_stack([np.all(atoms[:, list(rule.atoms)] == 1.0, axis=1) for rule in concepts]).astype(np.float64) \
            if concepts else np.zeros((atoms.shape[0], 0))
        count_b = concept_hits.sum(axis=0)
        total = max(atoms.shape[0], 1)
        prior_b = (count_b + 1.0) / (total + 2.0)                           # s_B
        strength_b = np.array([rule.rate for rule in concepts], dtype=np.float64)       # B -> Up
        together = atoms.T @ concept_hits                                   # (A, B) co-occurrence counts
        strength_ab = (together + pseudo * prior_b[None, :]) / (count_a[:, None] + pseudo)   # A -> B
        depth = int(p["maximum_chain_depth"])
        evidence = [strength_a * count_a]
        counts = [count_a.copy()]
        if depth >= 2 and concepts:
            chained = deduction(strength_ab, strength_b[None, :], prior_b[None, :], base)      # (A, B)
            evidence.append((chained * together).sum(axis=1))
            counts.append(together.sum(axis=1))
        if depth >= 3 and len(concepts) >= 2:
            both = concept_hits.T @ concept_hits                            # (B, B') co-occurrence
            strength_bb = (both + pseudo * prior_b[None, :]) / (count_b[:, None] + pseudo)     # B -> B'
            # A -> B' by deduction through each B (s_c = s_B'), averaged over B by co-occurrence with A
            through = deduction(strength_ab[:, :, None], strength_bb[None, :, :], prior_b[None, :, None],
                                prior_b[None, None, :])                                        # (A, B, B')
            weights = together / np.maximum(together.sum(axis=1, keepdims=True), 1e-12)
            s_ab_prime = np.einsum("ab,abc->ac", weights, through)
            chained = deduction(s_ab_prime, strength_b[None, :], prior_b[None, :], base)      # A -> B' -> Up
            weight = 0.5 * together                     # a two-step chain counts half the co-occurrence evidence
            evidence.append((chained * weight).sum(axis=1))
            counts.append(weight.sum(axis=1))
        self.atom_evidence = np.sum(evidence, axis=0)                       # sum of n_i s_i per atom
        self.atom_count = np.sum(counts, axis=0)                            # sum of n_i per atom
        self.base = float(base)
        self.concepts = [rule.name for rule in concepts]
        self.summary = {"concept_count": len(concepts), "chain_depth": depth, "base_rate": self.base}
        context.log(f"probabilistic logic network: {atoms.shape[1]} atoms, {len(concepts)} concepts, chain depth {depth}")
        return None

    def probability(self, truth: np.ndarray) -> np.ndarray:
        true = (truth == 1.0).astype(np.float64)
        count = true @ self.atom_count
        strength = np.divide(true @ self.atom_evidence, count, out=np.full(count.shape, self.base), where=count > 0)
        confidence = count / (count + float(self.parameters["evidence_scale"]))
        return confidence * strength + (1.0 - confidence) * self.base

    def score(self, context, rows):
        return logit(self.probability(context.truth(rows)))

    def state(self):
        return {"atomEvidence": to_list(self.atom_evidence), "atomCount": to_list(self.atom_count), "base": self.base,
                "concepts": self.concepts}

    def load(self, state):
        self.atom_evidence = np.asarray(state["atomEvidence"], dtype=np.float64)
        self.atom_count = np.asarray(state["atomCount"], dtype=np.float64)
        self.base = float(state["base"])
        self.concepts = list(state["concepts"])
