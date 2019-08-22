const {execSync} = require('child_process');

function red(string) {
  return `\x1b[31m${string}\x1b[0m`;
}

function exec(args) {
  return execSync(args, { stdio: [void 0, void 0, process.stderr], env: process.env }).toString();
}

function aws(cmd) {
  const response = JSON.parse(exec(`aws ${cmd}`));
  if (response.failures && response.failures.length) {
    throw new Error('The following failures occured: \n' + JSON.stringify(response.failures, null, 2));
  }
  return response;
}

function printUsage() {
  console.log('Usage:');
  console.log('\tnode deploy-ecs.js --region region --cluster cluster --service service --image image');
  console.log('\tnode deploy-ecs.js --region region --cluster cluster --service service --image image [--container-definition-patch \'{"cpu":64}\']');
  console.log('\tnode deploy-ecs.js --region region --cluster cluster --service service --image image [--container-definition-patch \'{"cpu":64}\'] [--timeout 60]');
  console.log('\tnode deploy-ecs.js --region region --cluster cluster --service service --image image [--container-definition-patch \'{"cpu":64}\'] [--timeout 60] [--remove-td-on-rollback]');
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
  printUsage();
  process.exit(1);
}

const {region, cluster, service, image} = argv;

// validate container-definition
let containerDefinitionPatch;
if (argv['container-definition-patch']) {
  try {
    containerDefinitionPatch = JSON.parse(argv['container-definition-patch']);
    if (('' + containerDefinitionPatch) !== '[object Object]') throw new Error('Invalid container-definition patch');
  } catch (error) {
    console.warn('Error parsing container definition');
    console.error(error);
    console.log('');
    printUsage();
    process.exit(1);
  }
}

function getService() {
  return aws(`ecs describe-services --region "${region}" --cluster "${cluster}" --services "${service}" --output json`).services[0];
}

function getTaskDefinition(arn) {
  return aws(`ecs describe-task-definition --region "${region}" --task-definition "${arn}" --output json`).taskDefinition;
}

function updateTaskDefinition(family, containerDefinitions, taskRoleArn, networkMode, volumes, placementConstraints) {
  let params = [
    `--region "${region}"`,
    `--family "${family}"`,
    `--container-definitions '${JSON.stringify(containerDefinitions)}'`,
  ];
  if (taskRoleArn) {
    params.push(`--task-role-arn ${taskRoleArn}`);
  }
  if (networkMode) {
    params.push(`--network-mode ${networkMode}`);
  }
  if (volumes) {
    params.push(`--volumes '${JSON.stringify(volumes)}'`);
  }
  if (placementConstraints) {
    params.push(`--placement-constraints '${JSON.stringify(placementConstraints)}'`);
  }
  return aws(`ecs register-task-definition ${params.join(' ')} --output json`).taskDefinition;
}

function updateService(taskDefinitionArn) {
  return aws(`ecs update-service --region "${region}" --cluster "${cluster}" --service "${service}" --task-definition "${taskDefinitionArn}" --output json`).service
}

function deregisterTaskDefinition(taskDefinitionArn) {
  return aws(`ecs deregister-task-definition --region "${region}" --task-definition "${taskDefinitionArn}" --output json`)
}

const SLEEP = 2;
const maxTries = (parseInt(argv.timeout, 10) || 60) / SLEEP

Promise.resolve()
  .then(() => {
    const oldTaskDefinitionArn = getService().taskDefinition;
    console.log(`Old task definion ARN: ${oldTaskDefinitionArn}`);

    const {family, containerDefinitions, taskRoleArn, networkMode, volumes, placementConstraints} = getTaskDefinition(oldTaskDefinitionArn);
    if (containerDefinitions.length !== 1) {
      throw new Error('Task definitions with more than one container are not supported');
    }

    const newTaskDefinition = updateTaskDefinition(family, [
      {...containerDefinitions[0], ...containerDefinitionPatch, image} // apply patch
    ], taskRoleArn, networkMode, volumes, placementConstraints);
    console.log(`New task definion ARN: ${newTaskDefinition.taskDefinitionArn}`);

    const newService = updateService(newTaskDefinition.taskDefinitionArn);

    console.log(`Waiting for service ${service} to be deployed`);

    // Wait to see if more than 1 deployment stays running
    for (let i = 0; i <= maxTries; ++ i) {
      const {deployments} = getService();
      if (deployments.length <= 1) {
        process.stdout.write('\n');
        console.log(`New version of ${service} deployed successfully`);
        return;
      }
      process.stdout.write(i % 10 === 9 ? '|' : '.');
      exec(`sleep ${SLEEP}`);
    }
    process.stdout.write('\n');

    // Timeout, rollback
    console.log(red(`Timeout after ${maxTries * SLEEP} seconds`));

    console.log(`Rolling back to ${oldTaskDefinitionArn}`);
    updateService(oldTaskDefinitionArn);
  
    if (argv['remove-td-on-rollback']) {
      console.log(`Deleting task definition ${newTaskDefinition.taskDefinitionArn}`);
      deregisterTaskDefinition(newTaskDefinition.taskDefinitionArn);
    }

    throw new Error(`Failed to deploy service ${service}`);
  })
  .then(() => process.exit(0))
  .catch(error => {
    process.stdout.write('\x1b[31m'); // red
    console.error(error.stack);
    process.stdout.write('\x1b[0m'); // reset
    process.exit(1);
  });
