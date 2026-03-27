"""
Shared pytest fixtures for nobo-web-control test suite.

All tests run in demo mode (NOBO_DEMO=true) so no real Nobø Hub is needed.
"""

import os
import pytest

# Force demo mode before importing the application module
os.environ.setdefault("NOBO_DEMO", "true")
