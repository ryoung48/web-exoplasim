import ast
import hashlib
import json
from pathlib import Path
import sys
import numpy as np

source = Path(sys.argv[1])
text = source.read_text(encoding='utf-8')
module = ast.parse(text)
selected = [item for item in module.body if isinstance(item, ast.FunctionDef) and item.name in {'Calc_PET', 'Estimate_evap'}]
assert len(selected) == 2
options = {'pet_gascon': 287.05}
namespace = {'np': np, 'verb': lambda message: None, 'opt': lambda name: options[name]}
exec(compile(ast.Module(body=selected, type_ignores=[]), str(source), 'exec'), namespace)
rng = np.random.default_rng(20261026)
cases = []
for index in range(64):
    args = {
        'temperature': float(rng.uniform(-20, 40)),
        'netRadiationWm2': float(rng.uniform(-50, 300)),
        'humidityPercent': float(rng.uniform(10, 100)),
        'pressureKpa': float(rng.uniform(30, 150)),
        'windMs': float(rng.uniform(0, 8)),
        'forestFraction': float(rng.uniform(0, 1)),
        'gasConstant': float(rng.uniform(180, 500)),
        'monthDays': [15, 30, 60, 90][index % 4],
    }
    options['pet_gascon'] = args['gasConstant']
    result = namespace['Calc_PET'](method='asce-pm', tas=args['temperature'], rnet=args['netRadiationWm2'], hur=args['humidityPercent'], ps=args['pressureKpa'], wind=args['windMs'], vegf=args['forestFraction'])
    cases.append({'input': args, 'expected': float(result) * args['monthDays'] / 30})
rainfall = np.zeros((12, 1, 1))
rainfall[-1, 0, 0] = 1000
soil_reference = namespace['Estimate_evap'](np.full((12, 1, 1), 10.0), rainfall).reshape(-1).tolist()
output = Path(sys.argv[2])
output.parent.mkdir(parents=True, exist_ok=True)
output.write_text(json.dumps({'sourceSha256': hashlib.sha256(source.read_bytes()).hexdigest(), 'petCases': cases, 'soilViewRegression': {'upstream': soil_reference, 'rainfall': rainfall.reshape(-1).tolist(), 'potential': [10.0] * 12, 'converged': [10.0] * 12}}, indent=2) + '\n')
print(f'Generated {len(cases)} ASCE PET expectations from upstream Calc_PET')
