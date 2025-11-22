
import os

from setuptools import setup

requirements_path = os.path.join(os.path.dirname(__file__), "requirements.txt")
with open(requirements_path, "r") as f:
    requirements = f.read().splitlines()

setup(
    name='null-engine-example-py',
    version='0.0',
    install_requires=requirements,
)
