// This provider is deliberately reachable only through repository test injection.
// Production commands always use the pinned TypeSafe Jev engine or fail closed.
export const testSemanticProvider = Object.freeze({
  id: "typesafe-jev",
  model: "jev-1.13.0",
  async evaluate(request) {
    const answers = Object.fromEntries(Object.entries(request.questionSet.questions).map(([name, question]) => [
      name,
      question.type === "choice" ? Object.keys(question.criteria)[0] : { noul: true },
    ]));
    return {
      model: "jev-1.13.0",
      answers,
      confidence: Object.fromEntries(Object.keys(answers).map((name) => [name, 0.95])),
      usage: { inputTokens: 0, outputTokens: 0 },
    };
  },
});

let activeTestSemanticProvider = null;

export function installTestSemanticProvider(provider = testSemanticProvider) {
  activeTestSemanticProvider = provider;
}

export function clearTestSemanticProvider() {
  activeTestSemanticProvider = null;
}

export function getTestSemanticProvider() {
  return activeTestSemanticProvider;
}
