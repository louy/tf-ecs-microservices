const {execSync} = require('child_process');

function red(string) {
  return `\x1b[31m${string}\x1b[0m`;
}

function exec(args) {
  return execSync(args, { stdio: [void 0, void 0, process.stderr] }).toString();
}

function aws(cmd) {
  const response = JSON.parse(exec(`aws ${cmd}`));
  if (response.failures && response.failures.length) {
    throw new Error('The following failures occured: \n' + JSON.stringify(response.failures, null, 2));
  }
  return response;
}

// take process arguments and convert them into an object
const argv = (() => {
  const argv = {};
  let lastArg = null;
  process.argv.forEach((arg, index, array) => {
    if (arg.indexOf('--') === 0) {
      if (lastArg) {
        argv[lastArg] = true;
        lastArg = null;
      }
      lastArg = arg.substr(2);
      if (array.length === index + 1) {
        // if it's the last one
        argv[arg.substr(2)] = true;
      }
      return;
    }
    if (lastArg) {
      argv[lastArg] = arg;
      lastArg = null;
    }
  });
  return argv;
})();

const required = ['region', 'cluster', 'service', 'image'];
if (required.some(key => !argv[key])) {
  console.log('Usage: node deploy-ecs.js --region region --cluster cluster --service service --image image ');
  process.exit(1);
}

const {region, cluster, service, image} = argv;

function getService() {
  return aws(`ecs describe-services --region "${region}" --cluster "${cluster}" --services "${service}" --output json`).services[0];
}

function getTaskDefinition(arn) {
  return aws(`ecs describe-task-definition --region "${region}" --task-definition "${arn}" --output json`).taskDefinition;
}

function updateTaskDefinition(family, containerDefinitions) {
  return aws(`ecs register-task-definition --region "${region}" --family "${family}" --container-definitions '${JSON.stringify(containerDefinitions)}' --output json`).taskDefinition;
}

function updateService(taskDefinitionArn) {
  return aws(`ecs update-service --region "${region}" --cluster "${cluster}" --service "${service}" --task-definition "${taskDefinitionArn}" --output json`).service
}

Promise.resolve()
  .then(() => {
    const oldTaskDefinitionArn = getService().taskDefinition;
    console.log(`Old task definion ARN: ${oldTaskDefinitionArn}`);

    const {family, containerDefinitions} = getTaskDefinition(oldTaskDefinitionArn);
    if (containerDefinitions.length !== 1) {
      throw new Error('Task definitions with more than one container are not supported');
    }

    const newTaskDefinition = updateTaskDefinition(family, [
      {...containerDefinitions[0], image} // update image field
    ]);
    console.log(`New task definion ARN: ${newTaskDefinition.taskDefinitionArn}`);

    const newService = updateService(newTaskDefinition.taskDefinitionArn);

    const SLEEP = 2;
    const MAX_TRIES = 30;

    console.log(`Waiting for service ${service} to be deployed`);

    // Wait to see if more than 1 deployment stays running
    for (let i = 0; i < MAX_TRIES; ++ i) {
      const {deployments} = getService();
      if (deployments.length <= 1) {
        process.stdout.write('\n');
        console.log(`New version of ${service} deployed successfully`);
        return;
      }
      process.stdout.write('.');
      exec(`sleep ${SLEEP}`);
    }

    // Timeout, rollback
    console.log(red(`Timeout after ${MAX_TRIES * SLEEP} seconds`));

    console.log(`Rolling back to ${oldTaskDefinitionArn}`);
    updateService(oldTaskDefinitionArn);

    throw new Error(`Failed to deploy service ${service}`);
  })
  .then(() => process.exit(0))
  .catch(error => {
    process.stdout.write('\x1b[31m'); // red
    console.error(error.stack);
    process.stdout.write('\x1b[0m'); // reset
    process.exit(1);
  });
