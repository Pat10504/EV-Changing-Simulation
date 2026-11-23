"""Test Python -> bundled MATLAB Engine -> Python without installing packages."""

import json
import math
import platform
import sys
from datetime import datetime
from pathlib import Path


MATLAB_ROOT = Path('/Applications/MATLAB_R2026b.app')
ENGINE_DIST = MATLAB_ROOT / 'extern/engines/python/dist'


def main():
    if not (3, 10) <= sys.version_info[:2] <= (3, 14):
        raise RuntimeError('Use Python 3.10–3.14 for MATLAB R2026b.')
    if platform.machine() != 'arm64':
        raise RuntimeError('This experiment expects native Apple silicon Python.')
    if not ENGINE_DIST.is_dir():
        raise RuntimeError(f'Bundled MATLAB Engine not found: {ENGINE_DIST}')

    # MathWorks supports importing the preinstalled Engine from this directory.
    # This changes only this Python process, not the global environment.
    sys.path.insert(0, str(ENGINE_DIST))
    import matlab
    import matlab.engine

    report = {
        'started_at': datetime.now().astimezone().isoformat(),
        'python_executable': sys.executable,
        'python_version': platform.python_version(),
        'architecture': platform.machine(),
        'engine_module': matlab.engine.__file__,
    }
    engine = None
    try:
        print('Starting a new MATLAB Engine session...', flush=True)
        engine = matlab.engine.start_matlab('-nodesktop -nosplash')
        report['matlab_version'] = engine.version(nargout=1)
        report['matlab_release'] = engine.version('-release', nargout=1)
        report['matlab_root'] = engine.matlabroot(nargout=1)
        assert report['matlab_release'] == '2026b', report
        assert Path(report['matlab_root']).resolve() == MATLAB_ROOT.resolve(), report

        scalar = engine.sqrt(81.0, nargout=1)
        assert math.isclose(scalar, 9.0, rel_tol=0, abs_tol=1e-12), scalar
        report['scalar'] = {'operation': 'sqrt(81)', 'result': scalar, 'passed': True}

        values = matlab.double([[1.0, 4.0, 9.0], [16.0, 25.0, 36.0]])
        result = engine.sqrt(values, nargout=1)
        rows = [list(row) for row in result]
        expected = [[1.0, 2.0, 3.0], [4.0, 5.0, 6.0]]
        assert tuple(result.size) == (2, 3), result.size
        assert rows == expected, rows
        report['array'] = {
            'operation': 'element-wise sqrt of a 2x3 matrix',
            'input': [list(row) for row in values],
            'result': rows,
            'passed': True,
        }
    finally:
        # Never connect to, close, or kill a pre-existing MATLAB session.
        if engine is not None:
            engine.quit()
            report['own_engine_closed'] = True
            print('Own MATLAB Engine session closed.', flush=True)

    report['finished_at'] = datetime.now().astimezone().isoformat()
    report['status'] = 'PASS'
    output = Path(__file__).with_name('result.json')
    output.write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')
    print(json.dumps(report, indent=2), flush=True)


if __name__ == '__main__':
    main()
