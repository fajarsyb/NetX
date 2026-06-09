import os
import importlib
import logging
from typing import List, Dict, Callable, Any
from app.plugins.base import BasePlugin

logger = logging.getLogger("netx.core.plugins")

class PluginManager:
    _instance = None
    _plugins: Dict[str, BasePlugin] = {}

    def __new__(cls, *args, **kwargs):
        if not cls._instance:
            cls._instance = super(PluginManager, cls).__new__(cls, *args, **kwargs)
        return cls._instance

    def __init__(self):
        if self._plugins:
            return
        self.load_plugins()

    def load_plugins(self):
        plugins_dir = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "plugins")
        if not os.path.exists(plugins_dir):
            return

        for folder in os.listdir(plugins_dir):
            if folder.startswith("__") or folder == "base.py" or folder == "__pycache__":
                continue
            folder_path = os.path.join(plugins_dir, folder)
            if os.path.isdir(folder_path):
                try:
                    # Dynamically import the package
                    module = importlib.import_module(f"app.plugins.{folder}")
                    plugin_instance = getattr(module, "plugin", None)
                    if plugin_instance:
                        self._plugins[plugin_instance.name] = plugin_instance
                        logger.info(f"Loaded plugin: {plugin_instance.title} v{plugin_instance.version}")
                    else:
                        logger.warning(f"Plugin package {folder} does not expose a 'plugin' instance attribute.")
                except Exception as e:
                    logger.error(f"Failed to load plugin {folder}: {e}", exc_info=True)

    def get_plugins(self) -> List[BasePlugin]:
        return list(self._plugins.values())

    def get_plugin(self, name: str) -> BasePlugin:
        return self._plugins.get(name)

    def get_routers(self) -> List[Dict[str, Any]]:
        """Returns list of dicts: {'router': router, 'prefix': prefix, 'dependencies': dependencies}"""
        routers = []
        for plugin in self._plugins.values():
            if plugin.router:
                routers.append({
                    "router": plugin.router,
                    "prefix": plugin.prefix,
                    "dependencies": plugin.dependencies
                })
        return routers

    def get_task_handler(self, task_name: str) -> Callable:
        """Find task handler across all plugins."""
        for plugin in self._plugins.values():
            if task_name in plugin.tasks:
                return plugin.tasks[task_name]
        return None

    def get_scheduled_tasks(self) -> List[Dict[str, Any]]:
        """Returns all scheduled tasks across all plugins."""
        tasks = []
        for plugin in self._plugins.values():
            tasks.extend(plugin.scheduled_tasks)
        return tasks

plugin_manager = PluginManager()
