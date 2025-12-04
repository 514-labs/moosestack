
from setuptools import setup

with open('requirements.txt') as f:
    requirements = [line.strip() for line in f if line.strip() and not line.startswith('#')]

setup(
    name='MyProjectTest',
    version='0.0',
    install_requires=requirements,
    python_requires='&gt;&#x3D;3.12',
)
