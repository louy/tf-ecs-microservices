# ecs-deploy script

## Usage

In an aws environment:

```sh
docker run -iet louy/ecs-deploy -e ecs-deploy --region "region" --cluster "cluster" --service "service" --image "image"
# Or...
docker run -iet louy/ecs-deploy -e ecs-deploy --region "region" --cluster "cluster" --service "service" --image "image" --container-definition-patch '{"cpu":64,"memory":128}' --timeout 120
```
