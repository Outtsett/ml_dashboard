import os
import re

directory = r'E:\source\repos\ml_dashboard'

replacements = [
    (r'E:\\source\\repos\\ml_dashboard\\trading_models', r'E:\\source\\repos\\ml_dashboard\\trading_models'),
    (r'E:/source/repos/ml_dashboard/trading_models', r'E:/source/repos/ml_dashboard/trading_models'),
    (r'E:\\source\\repos\\ml_dashboard\\Trading', r'E:\\source\\repos\\ml_dashboard\\Trading'),
    (r'E:/source/repos/ml_dashboard/Trading', r'E:/source/repos/ml_dashboard/Trading'),
    (r'E:\\source\\repos\\ml_dashboard\\ml-workspace', r'E:\\source\\repos\\ml_dashboard\\ml-workspace'),
    (r'E:/source/repos/ml_dashboard/ml-workspace', r'E:/source/repos/ml_dashboard/ml-workspace'),
]

# Adding case-insensitive replacements could be dangerous, but paths on Windows are case-insensitive.
# Let's use re.IGNORECASE for the match, but replace with the exact casing we specified.

def process_file(filepath):
    try:
        with open(filepath, 'r', encoding='utf-8') as f:
            content = f.read()
    except Exception as e:
        return False
        
    original_content = content
    modified = False
    
    for old_path, new_path in replacements:
        # We will use string replace for exact matches, it's safer. 
        # But wait, people might have used double backslashes in JSON: 'E:\\\\source\\\\repos\\\\ml_dashboard\\\\trading_models'
        
        # Exact replacements
        if old_path in content:
            content = content.replace(old_path, new_path)
            modified = True
            
        # Also handle double backslashes for JSON/strings
        old_path_esc = old_path.replace('\\\\', '\\\\\\\\')
        new_path_esc = new_path.replace('\\\\', '\\\\\\\\')
        if old_path_esc in content:
            content = content.replace(old_path_esc, new_path_esc)
            modified = True

    if modified:
        with open(filepath, 'w', encoding='utf-8') as f:
            f.write(content)
        return True
    return False

updated_files = []
skip_dirs = {'.git', 'node_modules', '.venv', 'venv', '__pycache__', 'dist', 'build', '.idea', '.vscode'}

for root, dirs, files in os.walk(directory):
    dirs[:] = [d for d in dirs if d not in skip_dirs]
    for file in files:
        if file.endswith(('.py', '.ts', '.tsx', '.js', '.jsx', '.json', '.yaml', '.yml', '.md', '.txt', '.csv', '.env', '.sh', '.ps1')):
            filepath = os.path.join(root, file)
            if process_file(filepath):
                updated_files.append(filepath)

print(f"Updated {len(updated_files)} files.")
for f in updated_files:
    print(f" - {f}")
