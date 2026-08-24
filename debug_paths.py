import os
import re

path_map = {
    'hooks/useTrainingSSE': 'training/lib/useTrainingSSE'
}

root_dir = os.path.abspath('src/client/src')
test_file = os.path.abspath('src/client/src/training/panels/PhaseAPanel.tsx')
import_path = '../../../hooks/useTrainingSSE'

abs_import = os.path.normpath(os.path.join(os.path.dirname(test_file), import_path))
print(f'Root: {root_dir}')
print(f'File: {test_file}')
print(f'Abs Import: {abs_import}')
print(f'Starts with root: {abs_import.startswith(root_dir)}')
target_rel_to_src = os.path.relpath(abs_import, root_dir).replace('\\', '/')
print(f'Rel to src: {target_rel_to_src}')
