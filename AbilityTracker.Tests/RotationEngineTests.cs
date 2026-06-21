using AbilityTracker.Import;
using AbilityTracker.Tracking;

namespace AbilityTracker.Tests;

[TestClass]
public sealed class RotationEngineTests
{
    [TestMethod]
    public void GroupCompletesInAnyOrderButNeedsEveryRequiredAction()
    {
        var engine = Create("Phase 1\n:a: + :b: → :c:");
        Assert.AreEqual(DetectionOutcome.Confirmed, engine.RegisterAction("b", DateTime.Now));
        Assert.AreEqual("a + b", TokenText(engine.GetSnapshot().Current));
        Assert.AreEqual(DetectionOutcome.Confirmed, engine.RegisterAction("a", DateTime.Now));
        Assert.AreEqual("c", TokenText(engine.GetSnapshot().Current));
    }

    [TestMethod]
    public void ResyncSkipsAtMostEightUpcomingSteps()
    {
        var sequence = string.Join(" → ", Enumerable.Range(0, 10).Select(i => $":a{i}:"));
        var engine = Create("Phase 1\n" + sequence);

        Assert.AreEqual(DetectionOutcome.Resynced, engine.RegisterAction("a7", DateTime.Now));
        Assert.IsTrue(engine.History.Count(item => item.Kind == TrackerHistoryKind.Skipped) >= 7);
        Assert.AreEqual(DetectionOutcome.Unexpected, engine.RegisterAction("a0", DateTime.Now));
    }

    [TestMethod]
    public void ExactFiftyChoosesLowAdrenalineBranch()
    {
        var document = new RotationParser().Parse("Drop Down\n>50% adren: :high:\n<50% adren: :low:");
        var engine = new RotationEngine(document);
        engine.Reset(50);
        engine.Start();

        Assert.AreEqual("low", TokenText(engine.GetSnapshot().Current));
    }

    [TestMethod]
    public void PhaseHandoffAllowsFillerAndCommitsOnNextPhaseAction()
    {
        var engine = Create("Phase 1\n:a: → :b:\nPhase 2\n:c: → :d:");
        engine.RegisterAction("a", DateTime.Now);
        engine.RegisterAction("b", DateTime.Now);
        Assert.IsTrue(engine.GetSnapshot().IsPhaseHandoff);

        Assert.AreEqual(DetectionOutcome.Extra, engine.RegisterAction("filler", DateTime.Now));
        Assert.AreEqual(DetectionOutcome.Resynced, engine.RegisterAction("c", DateTime.Now));
        Assert.AreEqual("d", TokenText(engine.GetSnapshot().Current));
        Assert.AreEqual("Phase 2", engine.GetSnapshot().SectionName);
    }

    [TestMethod]
    public void OptionalAlternativeCanBeSkippedByFollowingAction()
    {
        var engine = Create("Phase 1\n:a: → (:b: / :c:) → :d:");
        engine.RegisterAction("a", DateTime.Now);
        Assert.AreEqual(DetectionOutcome.Resynced, engine.RegisterAction("d", DateTime.Now));
        Assert.IsTrue(engine.GetSnapshot().IsPhaseHandoff || engine.GetSnapshot().Current is null);
    }

    private static RotationEngine Create(string source)
    {
        var engine = new RotationEngine(new RotationParser().Parse(source));
        engine.Start();
        return engine;
    }

    private static string TokenText(AbilityTracker.Domain.RotationStep? step) => step is null ? string.Empty :
        string.Join(" + ", step.Actions.Select(action => string.Join("/", action.Alternatives)));
}
