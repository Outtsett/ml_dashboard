import os
import re
from pathlib import Path

def process_file(filepath):
    with open(filepath, 'r', encoding='utf-8') as f:
        content = f.read()

    # Replacements for Python
    new_content = content
    # src.ml.tensionflow -> core.tensionflow
    new_content = re.sub(r'from\s+src\.ml\.tensionflow', 'from core.tensionflow', new_content)
    new_content = re.sub(r'import\s+src\.ml\.tensionflow', 'import core.tensionflow', new_content)
    
    # src.ml.shared -> core.shared
    new_content = re.sub(r'from\s+src\.ml\.shared', 'from core.shared', new_content)
    new_content = re.sub(r'import\s+src\.ml\.shared', 'import core.shared', new_content)
    
    # src.ml.blocks -> core.blocks
    new_content = re.sub(r'from\s+src\.ml\.blocks', 'from core.blocks', new_content)
    new_content = re.sub(r'import\s+src\.ml\.blocks', 'import core.blocks', new_content)
    
    # other src.ml.* models -> models.*
    models = ['xgb_classifier', 'moe_v1', 'tft_mnq_1d', 'lightgbm_for_moe_v1_slot1', 'logistic_regression_for_moe_v1_sklearn_slot1', 'moe_v1_sklearn', 'random_forest_for_moe_v1_sklearn_slot0', 'random_forest_for_moe_v1_slot0', 'rf_w2', 'gmm_w2']
    for model in models:
        new_content = re.sub(rf'from\s+src\.ml\.{model}', f'from models.{model}', new_content)
        new_content = re.sub(rf'import\s+src\.ml\.{model}', f'import models.{model}', new_content)
    
    # generic src.ml -> direct (for top-level ml files)
    new_content = re.sub(r'from\s+src\.ml\.', 'from ', new_content)
    new_content = re.sub(r'import\s+src\.ml\.', 'import ', new_content)

    if new_content != content:
        with open(filepath, 'w', encoding='utf-8') as f:
            f.write(new_content)
        print(f"Updated {filepath}")

def main():
    root = Path('.')
    for path in root.rglob('*.py'):
        if '.venv' in path.parts or '__pycache__' in path.parts or 'node_modules' in path.parts:
            continue
        process_file(path)

if __name__ == '__main__':
    main()
