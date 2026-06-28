export type RestartPreflightTask = (reason: string) => Promise<void>;

const tasks = new Map<string, RestartPreflightTask>();

export function registerRestartPreflightTask(id: string, task: RestartPreflightTask) {
  tasks.set(id, task);
  return () => {
    if (tasks.get(id) === task) tasks.delete(id);
  };
}

export async function runRestartPreflight(reason: string) {
  await Promise.all([...tasks.values()].map((task) => task(reason)));
}
