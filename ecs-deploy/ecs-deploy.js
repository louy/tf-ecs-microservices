const execSync = require('child_process').execSync;

function exec(args) {
  return execSync(args, { stdio: [void 0, void 0, process.stderr] }).toString();
}

// take process arguments and convert them into an object
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

const required = ['region', 'cluster', 'service', 'image'];
if (required.some(key => !argv[key])) {
  console.log('Usage: node deploy-ecs.js --region region --cluster cluster --service service --image image ');
  process.exit(1);
}

const region = argv.region;
const cluster = argv.cluster;
const service = argv.service;
const image = argv.image;
const existingServices = JSON.parse(exec(`aws ecs describe-services --region "${region}" --cluster "${cluster}" --services "${service}" --output json`)).services;
const oldTaskDefinitionArn = existingServices[0].taskDefinition;
console.log(`Old task definion ARN: ${oldTaskDefinitionArn}`);

const existingTaskDefinition = JSON.parse(exec(`aws ecs describe-task-definition --region "${region}" --task-definition "${oldTaskDefinitionArn}" --output json`)).taskDefinition;

const family = existingTaskDefinition.family;
const containerDefinitions = existingTaskDefinition.containerDefinitions;
if (containerDefinitions.length !== 1) throw new Error('Task definitions with more than one container are not supported');
containerDefinitions[0].image = image;

const newTaskDefinition = JSON.parse(exec(`aws ecs register-task-definition --region "${region}" --family "${family}" --container-definitions '${JSON.stringify(containerDefinitions)}' --output json`)).taskDefinition;

console.log(`New task definion ARN: ${newTaskDefinition.taskDefinitionArn}`);

const newService = JSON.parse(exec(`aws ecs update-service --region "${region}" --cluster "${cluster}" --service "${service}"  --task-definition "${newTaskDefinition.taskDefinitionArn}" --output json`)).service;

console.log(`New version of ${newService.serviceName} deployed successfully`);
