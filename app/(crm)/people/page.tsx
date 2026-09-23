import { PeopleList } from "./people-list";

export default function PeoplePage() {
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">People</h1>
      <PeopleList />
    </div>
  );
}
