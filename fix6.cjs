const fs = require('fs');
let content = fs.readFileSync('apps/web/src/ml/ModelCatalogPage.tsx', 'utf8');

// Replace selectedModelId local state with activeEntity logic
content = content.replace(
  "const [selectedModelId, setSelectedModelId] = useState<string | null>(null);",
  'const { activeEntity, setEntity } = useEntityStore();\n  const [, navigate] = useLocation();\n  const searchParams = new URLSearchParams(window.location.search);\n  const urlModelId = searchParams.get("model");\n  \n  const selectedModelId = (activeEntity?.type === "model" ? activeEntity.id : null) || urlModelId;\n\n  const setSelectedModelId = (id: string | null) => {\n    if (id) {\n      setEntity("model", id, id);\n      navigate("/models?model=" + encodeURIComponent(id));\n    } else {\n      setEntity(null, "", "");\n      navigate("/models");\n    }\n  };'
);

fs.writeFileSync('apps/web/src/ml/ModelCatalogPage.tsx', content);
