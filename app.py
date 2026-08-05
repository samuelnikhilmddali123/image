"""
app.py - Main Entry Point for AI Image Processor Application.

Initializes application dependencies, launches the CustomTkinter GUI,
and sets up global exception hooks.
"""

import sys
import logging
from utils import logger
from ui import AIImageAppUI


def global_exception_handler(exc_type, exc_value, exc_traceback):
    """
    Catches unhandled global exceptions and logs them cleanly without crashing silently.
    """
    if issubclass(exc_type, KeyboardInterrupt):
        sys.__excepthook__(exc_type, exc_value, exc_traceback)
        return

    logger.critical("Unhandled Exception Occurred!", exc_info=(exc_type, exc_value, exc_traceback))


def main():
    """
    Application main function.
    """
    # Set global exception handler
    sys.excepthook = global_exception_handler

    logger.info("Initializing AI Image Studio Desktop Application...")

    # Instantiate UI and start Tkinter event loop
    app = AIImageAppUI()
    app.mainloop()


if __name__ == "__main__":
    main()
