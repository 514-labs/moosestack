
from setuptools import setup
import os

requirements_path = os.path.join(os.path.dirname(__file__), "requirements.txt")
with open(requirements_path, "r") as f:
    requirements = f.read().splitlines()

setup(
    name='python-fastapi-client-only',
    version='0.0',
    install_requires=requirements,
)
